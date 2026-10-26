/** 动作选择仅使用确定性事实；有下一请求时绝不退化成额外 wake。 */
import type { ActionKind, AnchorMetadata, AttentionCandidate, AttentionFacts, SilentDecision, SuppressionReason } from "./contracts.js";
import type { PolicySettings } from "./profile-types.js";
import type { Runtime } from "./runtime.js";
import { sameFence } from "./input-validation.js";

/** 生命周期先于所有业务门槛，旧 callback 不具备任何决策权。 */
export function fenceReason(runtime: Runtime, candidate: Pick<AttentionCandidate, "fence" | "provenance">): SuppressionReason | undefined {
  if (!runtime.active) return "closed";
  if (!sameFence(runtime.fence, candidate.fence)) return "stale-fence";
  if (candidate.provenance === "attention") return "self-trigger";
  return undefined;
}

/** 只选择原机会对应的动作，不从能力缺失推断更强动作。 */
export function selectAction(facts: AttentionFacts, settings: PolicySettings): ActionKind | SuppressionReason {
  if (facts.evidenceCount < settings.minEvidence) return "insufficient-evidence";
  if (facts.nextRequest === "available") {
    if (!settings.allowReanchor) return "action-disabled";
    return facts.capabilities.reanchor ? "reanchor" : "unsupported";
  }
  if (facts.nextRequest === "unknown" || facts.activity === "unknown" || facts.continuation === "unknown") return "unknown-state";
  if (facts.activity !== "settled" || facts.continuation !== "none") return "no-opportunity";
  if (!settings.allowWake) return "action-disabled";
  return facts.capabilities.wake ? "wake" : "unsupported";
}

/** 当前锚点必须仍与候选关联，不生成缺失内容的回退。 */
export function anchorReason(candidate: AttentionCandidate, anchor: AnchorMetadata | undefined,
  settings: PolicySettings, now: number): SuppressionReason | undefined {
  if (candidate.decisionDeadline !== undefined && candidate.decisionDeadline <= now) return "expired";
  if (!anchor) return "missing-anchor";
  if (anchor.ref.provider !== candidate.anchor.provider || anchor.ref.id !== candidate.anchor.id) return "anchor-changed";
  if (anchor.expiresAt !== undefined && anchor.expiresAt <= now) return "expired";
  if (anchor.sizeBytes > settings.maxAnchorBytes) return "anchor-too-large";
  return undefined;
}

/** defer 只表达仍在 deadline 内可重新评估，不建立补发任务。 */
export function silent(reason: SuppressionReason, candidate: AttentionCandidate, now: number): SilentDecision {
  const recoverable = ["no-opportunity", "unknown-state", "cooldown", "wake-cooldown", "reserved", "pending-capacity"];
  const disposition = candidate.decisionDeadline !== undefined && candidate.decisionDeadline > now
    && recoverable.includes(reason) ? "defer" : "drop";
  return { kind: "silent", reason, disposition };
}
