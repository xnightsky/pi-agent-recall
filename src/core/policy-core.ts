/** 唯一 owner 的纯核心组合；prepare 与宿主同步提交之间的原子性由组合根保证。 */
import type {
  AttentionDecision, CommitResult, DeliveryPermit, DeliveryResult, EvaluateInput,
  PrepareInput, PrepareResult, TransitionEvent, TransitionResult,
} from "./contracts.js";
import type { AttentionConfig } from "./profile-types.js";
import type { PolicyCore, PolicyCoreOptions, PolicyState } from "./runtime-types.js";
import { anchorReason, fenceReason, selectAction, silent } from "./decision.js";
import { prepareDelivery, commitDelivery } from "./delivery.js";
import { anchorKey, copy, validateEvaluation, validateTransition } from "./input-validation.js";
import { charge, createLedger, ledgerReason } from "./ledger.js";
import { resolveProfile } from "./profile.js";
import { advance, createRuntime, increment, invalidate, log, snapshot, type Runtime } from "./runtime.js";
import { until } from "./validation.js";

class Core implements PolicyCore {
  private readonly runtime: Runtime;
  constructor(options: PolicyCoreOptions) { this.runtime = createRuntime(options); }

  evaluate(input: EvaluateInput): AttentionDecision {
    validateEvaluation(input);
    const runtime = this.runtime;
    advance(runtime, input.now);
    const { candidate, anchor, now } = input;
    const settings = runtime.profile.settings;
    const reason = fenceReason(runtime, candidate) ?? (settings.mode === "off" ? "off" : undefined)
      ?? anchorReason(candidate, anchor, settings, now);
    if (reason) return this.suppress(input, reason);
    const action = selectAction(candidate.facts, settings);
    if (action !== "reanchor" && action !== "wake") return this.suppress(input, action);
    const ledger = settings.mode === "shadow" ? runtime.shadow : runtime.real;
    const blocked = ledgerReason(ledger, anchor!, action, settings, now);
    if (blocked) return this.suppress(input, blocked);
    const key = anchorKey(anchor!);
    if ([...runtime.pending.values()].some(item => anchorKey(item.reservation.anchor) === key)) return this.suppress(input, "reserved");
    if (runtime.pending.size + runtime.awaiting.size >= settings.maxPending) return this.suppress(input, "pending-capacity");
    const expiresAt = Math.min(until(now, settings.reservationTtlMs),
      action === "wake" ? until(now, settings.wakeTtlMs) : Number.MAX_SAFE_INTEGER,
      candidate.decisionDeadline ?? Number.MAX_SAFE_INTEGER, anchor!.expiresAt ?? Number.MAX_SAFE_INTEGER);
    if (expiresAt <= now) return this.suppress(input, "expired");
    if (settings.mode === "shadow") {
      charge(runtime.shadow, anchor!, action, settings, now);
      log(runtime, { event: "evaluate", action, reason: "shadow", anchor: anchor!, facts: candidate.facts });
      return { kind: "silent", reason: "shadow", disposition: "drop", wouldAction: action };
    }
    runtime.sequence = increment(runtime.sequence);
    const reservation = { id: JSON.stringify([runtime.fence.incarnation, runtime.sequence]), fence: copy(runtime.fence),
      anchor: copy(anchor!), action, expiresAt };
    runtime.pending.set(reservation.id, copy({ reservation, candidate }));
    log(runtime, { event: "evaluate", action, reason: "eligible", anchor: anchor!, facts: candidate.facts });
    return copy({ kind: action, reason: "eligible", reservation });
  }

  private suppress(input: EvaluateInput, reason: Parameters<typeof silent>[0]): AttentionDecision {
    log(this.runtime, { event: "evaluate", action: "silent", reason,
      ...(input.anchor ? { anchor: input.anchor } : {}), facts: input.candidate.facts });
    return silent(reason, input.candidate, input.now);
  }

  prepareDelivery(id: string, input: PrepareInput): PrepareResult { return prepareDelivery(this.runtime, id, input); }
  commitDelivery(permit: DeliveryPermit, result: DeliveryResult, now: number): CommitResult { return commitDelivery(this.runtime, permit, result, now); }

  applyConfig(config: AttentionConfig): void {
    if (!this.runtime.active) throw new Error("core is closed");
    const profile = resolveProfile(config);
    const revision = increment(this.runtime.fence.revision);
    const changedMode = profile.settings.mode !== this.runtime.profile.settings.mode;
    invalidate(this.runtime);
    this.runtime.profile = profile;
    this.runtime.fence.revision = revision;
    if (changedMode) this.runtime.shadow = createLedger();
    this.runtime.logs.splice(0, Math.max(0, this.runtime.logs.length - profile.settings.maxLogEntries));
  }

  transition(event: TransitionEvent): TransitionResult {
    validateTransition(event);
    advance(this.runtime, event.now);
    const reason = fenceReason(this.runtime, event);
    if (reason) return { status: "ignored", reason: reason as "closed" | "stale-fence" | "self-trigger" };
    const fence = copy(this.runtime.fence);
    if (event.kind === "activity") fence.epoch = increment(fence.epoch);
    else {
      fence.generation = increment(fence.generation);
      fence.epoch = 0;
      if (event.kind === "session") fence.scope = event.scope;
    }
    invalidate(this.runtime);
    this.runtime.fence = fence;
    for (const ledger of [this.runtime.real, this.runtime.shadow]) { ledger.attempts = 0; ledger.wakeAttempts = 0; }
    return { status: "applied", fence: copy(fence) };
  }

  close(): void { invalidate(this.runtime); this.runtime.active = false; }
  getState(): PolicyState { return snapshot(this.runtime); }
}

/** 创建不含宿主与 I/O 的实例；调用者必须保证 incarnation 唯一并 close 旧实例。 */
export function createPolicyCore(options: PolicyCoreOptions): PolicyCore { return new Core(options); }
