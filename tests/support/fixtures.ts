/** 两类消费来源的契约样例，不声称对应仓库已集成。 */
import * as api from "../../src/core/index.js";
import type {
  AnchorMetadata, AttentionFacts, EvaluateInput, PolicyCore, PolicySettings,
} from "../../src/core/index.js";

/** 固定精确归因键，所有参数仅供零 token 契约测试。 */
export const context = {
  host: "fixture", hostVersion: "1", provider: "fixture", model: "fixture-model",
  modelRevision: "1", taskFamily: "contract", roleTopology: "single",
  policyVersion: "policy-1", reminderTextVersion: "text-1",
};

/** 显式开启测试策略，不改变生产 conservative/off 默认。 */
export function config(override: Partial<PolicySettings> = {}) {
  return { context, override: { mode: "emit" as const, allowWake: true, cooldownMs: 10,
    wakeCooldownMs: 20, dedupeMs: 50, maxAttemptsPerEpoch: 3, maxWakePerEpoch: 2,
    reservationTtlMs: 100, wakeTtlMs: 30, ...override } };
}

/** 通过公开入口构造；缺少 factory 时让 RED 失败在明确断言。 */
export function makeCore(override: Partial<PolicySettings> = {}, incarnation = "runtime-1"): PolicyCore {
  const factory = (api as Record<string, unknown>).createPolicyCore;
  if (typeof factory !== "function") throw new Error("createPolicyCore not implemented");
  return factory({ scope: "session-a", owner: "owner", incarnation, config: config(override) });
}

/** 当前角色或规则的无正文摘要。 */
export function anchor(provider = "roles", id = "current", version = "v1"): AnchorMetadata {
  return { ref: { provider, id }, version, sizeBytes: 16 };
}

/** 已存在下一请求时可重锚定的完整事实。 */
export function facts(patch: Partial<AttentionFacts> = {}): AttentionFacts {
  return { nextRequest: "available", activity: "active", continuation: "present",
    evidenceCount: 1, capabilities: { reanchor: true, wake: true }, ...patch };
}

/** 用当前 fence 生成候选；旧 callback 测试保留该返回值而非重新取 fence。 */
export function input(core: PolicyCore, now = 0, metadata = anchor(), patch: Partial<AttentionFacts> = {}): EvaluateInput {
  return { now, anchor: metadata, candidate: {
    fence: core.getState().fence, anchor: metadata.ref, facts: facts(patch),
    observedAt: now, provenance: "external",
  } };
}

/** 断言真实决策签发预留后返回 id。 */
export function reserve(core: PolicyCore, now = 0, metadata = anchor()) {
  const decision = core.evaluate(input(core, now, metadata));
  if (decision.kind === "silent") throw new Error("expected reservation: " + decision.reason);
  return decision.reservation;
}

/** 以当前元数据同步 prepare，供竞争和账本测试。 */
export function prepare(core: PolicyCore, id: string, now = 0, metadata = anchor(), patch: Partial<AttentionFacts> = {}) {
  return core.prepareDelivery(id, { now, anchor: metadata, facts: facts(patch), fence: core.getState().fence });
}
