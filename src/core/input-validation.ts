/** 外部数据校验边界；先完整校验，再推进时钟或修改状态。 */
import type {
  AnchorMetadata, AnchorRef, AttentionCandidate, AttentionFacts, DeliveryPermit,
  EvaluateInput, PolicyFence, PrepareInput, TransitionEvent,
} from "./contracts.js";
import { integer, member, object, text } from "./validation.js";

/** 复制已校验的 JSON 数据，使返回值与内部状态隔离。 */
export function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

/** 校验消费者引用，拒绝任意额外数据。 */
export function validateRef(value: unknown): asserts value is AnchorRef {
  const data = object(value, "ref", ["provider", "id"]);
  text(data.provider, "ref.provider");
  text(data.id, "ref.id");
}

/** 校验完整 fence；不自动补齐旧 callback 缺失的字段。 */
export function validateFence(value: unknown): asserts value is PolicyFence {
  const data = object(value, "fence", ["scope", "owner", "incarnation", "revision", "generation", "epoch"]);
  for (const key of ["scope", "owner", "incarnation"]) text(data[key], "fence." + key);
  for (const key of ["revision", "generation", "epoch"]) integer(data[key], "fence." + key);
}

/** 比较完整 fence，不依赖字符串连接或对象身份。 */
export function sameFence(a: PolicyFence, b: PolicyFence): boolean {
  return a.scope === b.scope && a.owner === b.owner && a.incarnation === b.incarnation
    && a.revision === b.revision && a.generation === b.generation && a.epoch === b.epoch;
}

/** 引用版本使用元组编码，避免 namespace 分隔符碰撞。 */
export function anchorKey(anchor: AnchorMetadata): string {
  return JSON.stringify([anchor.ref.provider, anchor.ref.id, anchor.version]);
}

/** 校验当前元数据，不允许正文进入 core。 */
export function validateAnchor(value: unknown): asserts value is AnchorMetadata {
  const data = object(value, "anchor", ["ref", "version", "sizeBytes", "expiresAt"]);
  validateRef(data.ref);
  text(data.version, "anchor.version");
  integer(data.sizeBytes, "anchor.sizeBytes");
  if (data.expiresAt !== undefined) integer(data.expiresAt, "anchor.expiresAt");
}

/** 明确枚举所有可观测事实及能力。 */
export function validateFacts(value: unknown): asserts value is AttentionFacts {
  const data = object(value, "facts", ["nextRequest", "activity", "continuation", "evidenceCount", "capabilities"]);
  member(data.nextRequest, ["available", "none", "unknown"], "nextRequest");
  member(data.activity, ["active", "settled", "unknown"], "activity");
  member(data.continuation, ["present", "none", "unknown"], "continuation");
  integer(data.evidenceCount, "evidenceCount");
  const capabilities = object(data.capabilities, "capabilities", ["reanchor", "wake"]);
  member(capabilities.reanchor, [true, false], "capabilities.reanchor");
  member(capabilities.wake, [true, false], "capabilities.wake");
}

function validateCandidate(value: unknown, now: number): asserts value is AttentionCandidate {
  const data = object(value, "candidate", ["fence", "anchor", "facts", "observedAt", "decisionDeadline", "provenance"]);
  validateFence(data.fence);
  validateRef(data.anchor);
  validateFacts(data.facts);
  integer(data.observedAt, "observedAt", 0, now);
  if (data.decisionDeadline !== undefined) integer(data.decisionDeadline, "decisionDeadline");
  member(data.provenance, ["external", "attention"], "provenance");
}

/** 校验 evaluate 全输入，任何错误不部分应用。 */
export function validateEvaluation(value: unknown): asserts value is EvaluateInput {
  const data = object(value, "evaluate", ["candidate", "anchor", "now"]);
  integer(data.now, "now");
  validateCandidate(data.candidate, data.now);
  if (data.anchor !== undefined) validateAnchor(data.anchor);
}

/** 校验 prepare 最新输入。 */
export function validatePrepare(value: unknown): asserts value is PrepareInput {
  const data = object(value, "prepare", ["fence", "anchor", "facts", "now"]);
  integer(data.now, "now");
  validateFence(data.fence);
  validateFacts(data.facts);
  if (data.anchor !== undefined) validateAnchor(data.anchor);
}

/** 校验外部 lifecycle 事件，未知事件明确拒绝。 */
export function validateTransition(value: unknown): asserts value is TransitionEvent {
  const data = object(value, "transition", ["kind", "scope", "fence", "provenance", "now"]);
  member(data.kind, ["activity", "session", "reload"], "transition.kind");
  if (data.kind === "session") text(data.scope, "transition.scope");
  else if (data.scope !== undefined) throw new TypeError("scope requires session transition");
  validateFence(data.fence);
  member(data.provenance, ["external", "attention"], "provenance");
  integer(data.now, "now");
}

/** 校验回执关联许可，不能插入采用状态或任意 payload。 */
export function validatePermit(value: unknown): asserts value is DeliveryPermit {
  const data = object(value, "permit", ["id", "fence", "anchor", "action", "expiresAt", "receiptDeadline"]);
  text(data.id, "permit.id", 4096);
  validateFence(data.fence);
  validateAnchor(data.anchor);
  member(data.action, ["reanchor", "wake"], "permit.action");
  integer(data.expiresAt, "permit.expiresAt");
  integer(data.receiptDeadline, "permit.receiptDeadline");
}
