/** Pi 事件组合根；唯一 session emit owner 在这里持有 core，不进入 core。 */
import { randomUUID } from "node:crypto";
import type { AttentionConfig, PolicyCore, PolicyFence } from "../core/index.js";
import { createPolicyCore } from "../core/index.js";
import type { PiAnchorProvider, PiDeliverySink, PiMessage, PiSettleBoundary } from "./host-types.js";
import { createRecallRuntime, type RecallRuntime } from "./recall-runtime.js";

/** 无正文适配器诊断；用于测试证据和 fail-closed 观察。 */
export interface PiRecallTrace {
  event: string;
  delivered?: boolean;
  reason?: string;
  fence?: PolicyFence;
}

/** 本 adapter 使用的最小 ExtensionAPI 结构。 */
export interface PiExtensionApi { on(event: string, handler: (event: unknown) => unknown): void }

/** 测试先行 extension 的同步依赖；不读取全局配置或宿主凭据。 */
export interface PiRecallExtensionOptions {
  scope: string;
  owner: string;
  config: AttentionConfig;
  anchors: PiAnchorProvider;
  now(): number;
  trace(entry: PiRecallTrace): void;
  createIncarnation?(): string;
  createCore?(incarnation: string, config: AttentionConfig): PolicyCore;
  sink?: PiDeliverySink;
}

interface BeforeStart { messageType: "user" | "custom"; message?: { customType?: string } }
interface Context { messages: PiMessage[] }

/** 创建仅由调用方显式加载的 Pi extension factory。 */
export function createPiRecallExtension(options: PiRecallExtensionOptions): (pi: PiExtensionApi) => void {
  return (pi) => {
    let core: PolicyCore | undefined;
    let runtime: RecallRuntime | undefined;
    const seen = new WeakSet<object>();
    const trace = (entry: PiRecallTrace) => options.trace(entry);
    const close = () => {
      runtime?.close();
      runtime = undefined;
      core = undefined;
      trace({ event: "close" });
    };
    const current = (event: string): RecallRuntime | undefined => {
      if (runtime) return runtime;
      trace({ event, reason: "closed" });
      return undefined;
    };
    const guard = (event: string, action: () => unknown): unknown => {
      try { return action(); }
      catch { trace({ event, reason: "error" }); return undefined; }
    };

    pi.on("session_start", () => guard("session_start", () => {
      runtime?.close();
      const incarnation = options.createIncarnation?.() ?? randomUUID();
      core = options.createCore?.(incarnation, options.config) ?? createPolicyCore({ scope: options.scope, owner: options.owner,
        incarnation, config: options.config });
      runtime = createRecallRuntime({ core, anchors: options.anchors, ...(options.sink ? { sink: options.sink } : {}) });
      trace({ event: "runtime", fence: core.getState().fence });
    }));
    pi.on("before_agent_start", raw => guard("before_agent_start", () => {
      const event = raw as BeforeStart;
      current("before_agent_start")?.beginRun(event.messageType === "custom"
        && event.message?.customType === "pi-agent-recall.wake.v1" ? "attention" : "external", options.now());
    }));
    pi.on("context", raw => guard("context", () => {
      const active = current("context");
      if (!active) return undefined;
      const result = active.reanchor((raw as Context).messages, options.now());
      trace({ event: "reanchor", delivered: result.delivered,
        ...(result.reason ? { reason: result.reason } : {}) });
      return result.delivered ? { messages: result.messages } : undefined;
    }));
    pi.on("agent_before_settle", raw => guard("agent_before_settle", () => {
      const active = current("agent_before_settle");
      if (!active) return undefined;
      const result = active.wake(raw as PiSettleBoundary, options.now());
      trace({ event: "wake", delivered: result.delivered,
        ...(result.reason ? { reason: result.reason } : {}) });
      return result.delivered ? result.result : undefined;
    }));
    pi.on("input", raw => activity(raw, "input"));
    pi.on("tool_execution_end", raw => activity(raw, "tool_execution_end"));
    pi.on("session_before_compact", raw => reload(raw, "session_before_compact"));
    pi.on("session_before_tree", raw => reload(raw, "session_before_tree"));
    pi.on("session_before_switch", () => close());
    pi.on("session_shutdown", () => close());

    function activity(raw: unknown, event: string): void {
      guard(event, () => {
        if (raw && typeof raw === "object") {
          if (seen.has(raw)) return;
          seen.add(raw);
        }
        if (!core) { trace({ event, reason: "closed" }); return; }
        const result = core.transition({ kind: "activity", fence: core.getState().fence,
          provenance: "external", now: options.now() });
        trace({ event: "activity", ...(result.status === "applied" ? { fence: result.fence } : { reason: result.reason }) });
      });
    }
    function reload(raw: unknown, event: string): void {
      guard(event, () => {
        if (!core) { trace({ event, reason: "closed" }); return; }
        const result = core.transition({ kind: "reload", fence: core.getState().fence,
          provenance: "external", now: options.now() });
        trace({ event: "reload", ...(result.status === "applied" ? { fence: result.fence } : { reason: result.reason }) });
      });
    }
  };
}
