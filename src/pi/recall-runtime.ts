/** 同步 recall 投递内核；prepare 与本地 sink 之间不等待、不排队。 */
import type {
  ActionKind, AttentionFacts, DeliveryPermit, PolicyCore, SuppressionReason,
  TransitionEvent, TransitionResult,
} from "../core/index.js";
import { readAnchor } from "./anchor.js";
import type {
  PiAnchorProvider, PiBoundaryResult, PiDeliverySink, PiMessage, PiSettleBoundary,
} from "./host-types.js";

/** 创建同步投递内核所需的真实 core、消费者锚点与宿主 sink。 */
export interface RecallRuntimeOptions {
  core: PolicyCore;
  anchors: PiAnchorProvider;
  sink?: PiDeliverySink;
}

/** reanchor 的请求级结果；未投递时保留原消息。 */
export interface ReanchorResult { messages: PiMessage[]; delivered: boolean; reason?: string }

/** wake 的边界结果；未投递时不请求 continuation。 */
export interface WakeResult { result?: PiBoundaryResult; delivered: boolean; reason?: string }

/** 组合 core 与消费者快照的同步生命周期和投递接口。 */
export interface RecallRuntime {
  beginRun(provenance: "external" | "attention", now: number): void;
  reanchor(messages: readonly PiMessage[], now: number): ReanchorResult;
  wake(boundary: PiSettleBoundary, now: number): WakeResult;
  transition(event: TransitionEvent): TransitionResult;
  close(): void;
}

const reanchorFacts: AttentionFacts = { nextRequest: "available", activity: "active", continuation: "unknown",
  evidenceCount: 1, capabilities: { reanchor: true, wake: false } };
const wakeFacts: AttentionFacts = { nextRequest: "none", activity: "settled", continuation: "none",
  evidenceCount: 1, capabilities: { reanchor: false, wake: true } };

function isAttentionBoundary(boundary: PiSettleBoundary): boolean {
  const messages = boundary.context.contextMessages;
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index--) {
    const message = messages![index]!;
    if (message.role !== "custom" && message.role !== "user") continue;
    return message.customType === "pi-agent-recall.wake.v1";
  }
  return false;
}

class Runtime implements RecallRuntime {
  private reservationId: string | undefined;
  private reason: string | undefined;
  constructor(private readonly options: RecallRuntimeOptions) {}

  beginRun(provenance: "external" | "attention", now: number): void {
    this.reservationId = undefined;
    const current = readAnchor(this.options.anchors);
    if (!current) { this.reason = "missing-anchor"; return; }
    const decision = this.options.core.evaluate({ now, anchor: current.metadata, candidate: {
      fence: this.options.core.getState().fence, anchor: current.metadata.ref,
      facts: reanchorFacts, observedAt: now, provenance,
    } });
    this.reason = decision.kind === "silent" ? decision.reason : undefined;
    if (decision.kind !== "silent") this.reservationId = decision.reservation.id;
  }

  reanchor(messages: readonly PiMessage[], now: number): ReanchorResult {
    const id = this.reservationId;
    this.reservationId = undefined;
    if (!id) return { messages: [...messages], delivered: false, ...(this.reason ? { reason: this.reason } : {}) };
    const current = readAnchor(this.options.anchors);
    const prepared = this.options.core.prepareDelivery(id, { now: this.freshNow(now), fence: this.options.core.getState().fence,
      facts: reanchorFacts, ...(current ? { anchor: current.metadata } : {}) });
    if (prepared.status === "rejected") return { messages: [...messages], delivered: false, reason: prepared.reason };
    const message = { role: "custom", customType: "pi-agent-recall.reanchor.v1",
      content: current!.snapshot.content, display: false, timestamp: now };
    if (!this.accept("reanchor", prepared.permit, now)) return { messages: [...messages], delivered: false, reason: "sink-failed" };
    return { messages: [...messages, message], delivered: true };
  }

  wake(boundary: PiSettleBoundary, now: number): WakeResult {
    if (isAttentionBoundary(boundary)) return { delivered: false, reason: "self-trigger" };
    const unavailable = boundary.outcome !== "completed" || boundary.continue
      || boundary.context.pendingMessages.length > 0;
    if (unavailable) return { delivered: false, reason: "no-opportunity" };
    const first = readAnchor(this.options.anchors);
    if (!first) return { delivered: false, reason: "missing-anchor" };
    const decision = this.options.core.evaluate({ now, anchor: first.metadata, candidate: {
      fence: this.options.core.getState().fence, anchor: first.metadata.ref,
      facts: wakeFacts, observedAt: now, provenance: "external",
    } });
    if (decision.kind === "silent") return { delivered: false, reason: decision.reason };
    const current = readAnchor(this.options.anchors);
    const prepared = this.options.core.prepareDelivery(decision.reservation.id, { now: this.freshNow(now),
      fence: this.options.core.getState().fence, facts: wakeFacts,
      ...(current ? { anchor: current.metadata } : {}) });
    if (prepared.status === "rejected") return { delivered: false, reason: prepared.reason };
    const result: PiBoundaryResult = { entries: [{ type: "custom_message", customType: "pi-agent-recall.wake.v1",
      content: current!.snapshot.content, display: false }], continue: true };
    if (!this.accept("wake", prepared.permit, now)) return { delivered: false, reason: "sink-failed" };
    return { result, delivered: true };
  }

  transition(event: TransitionEvent): TransitionResult { return this.options.core.transition(event); }
  close(): void { this.options.core.close(); }

  /** 嵌套转换可能已推进实例时钟；core 拒绝时钟倒退，此处钳制到实例已知最新时刻。 */
  private freshNow(now: number): number {
    const known = this.options.core.getState().now;
    return known > now ? known : now;
  }

  private accept(action: ActionKind, permit: DeliveryPermit, now: number): boolean {
    try { this.options.sink?.accept(action); }
    catch { this.options.core.commitDelivery(permit, "failed", this.freshNow(now)); return false; }
    // sink 内可能嵌套推进时钟；钳制发生在 commit 调用点而非 sink 之前。
    this.options.core.commitDelivery(permit, "submitted", this.freshNow(now));
    return true;
  }
}

/** 创建不含 I/O 的同步 adapter 内核。 */
export function createRecallRuntime(options: RecallRuntimeOptions): RecallRuntime { return new Runtime(options); }
