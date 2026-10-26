/** 纯数据边界；仅无正文元数据进入 core，所有时刻由调用者显式提供。 */

/** 消费者命名空间内的锚点引用。 */
export interface AnchorRef { provider: string; id: string }

/** 当前快照的可信摘要；正文与大小计算由消费者拥有。 */
export interface AnchorMetadata {
  ref: AnchorRef;
  version: string;
  sizeBytes: number;
  expiresAt?: number;
}

/** 完整生命周期栅栏；incarnation 必须由组合根保证 runtime 唯一。 */
export interface PolicyFence {
  scope: string;
  owner: string;
  incarnation: string;
  revision: number;
  generation: number;
  epoch: number;
}

/** 明确可观测事实；unknown 不等价于否，不接收任意语义字段。 */
export interface AttentionFacts {
  nextRequest: "available" | "none" | "unknown";
  activity: "active" | "settled" | "unknown";
  continuation: "present" | "none" | "unknown";
  evidenceCount: number;
  capabilities: { reanchor: boolean; wake: boolean };
}

/** 候选捕获当时 fence；不持有正文，不承担补发队列职责。 */
export interface AttentionCandidate {
  fence: PolicyFence;
  anchor: AnchorRef;
  facts: AttentionFacts;
  observedAt: number;
  decisionDeadline?: number;
  provenance: "external" | "attention";
}

/** 只在明确机会和能力下建议的两种非沉默动作。 */
export type ActionKind = "reanchor" | "wake";

/** 有界抑制原因，不含任意正文或异常对象。 */
export type SuppressionReason =
  | "closed" | "stale-fence" | "self-trigger" | "off" | "expired"
  | "missing-anchor" | "anchor-changed" | "anchor-too-large" | "insufficient-evidence"
  | "no-opportunity" | "unknown-state" | "unsupported" | "action-disabled"
  | "duplicate" | "reserved" | "cooldown" | "wake-cooldown" | "budget"
  | "wake-budget" | "pending-capacity" | "dedupe-capacity" | "stale-reservation";

/** evaluate 的显式输入；缺失当前锚点是正常抑制条件。 */
export interface EvaluateInput {
  candidate: AttentionCandidate;
  anchor?: AnchorMetadata;
  now: number;
}

/** 临时预留，不是投递许可；使用前必须重新读取快照并 prepare。 */
export interface Reservation {
  id: string;
  fence: PolicyFence;
  anchor: AnchorMetadata;
  action: ActionKind;
  expiresAt: number;
}

/** 沉默决策；defer 不代表 core 持有队列，shadow 不产生预留。 */
export interface SilentDecision {
  kind: "silent";
  reason: SuppressionReason | "shadow";
  disposition: "drop" | "defer";
  retryAt?: number;
  wouldAction?: ActionKind;
}

/** 可执行决策只包含预留；同 ref@version 并发须重新评估。 */
export interface ActionDecision {
  kind: ActionKind;
  reason: "eligible";
  reservation: Reservation;
}

/** 纯策略输出，不是模型采用或业务完成证明。 */
export type AttentionDecision = SilentDecision | ActionDecision;

/** 投递前复核必须使用当前 fence、快照元数据和当前事实。 */
export interface PrepareInput {
  fence: PolicyFence;
  anchor?: AnchorMetadata;
  facts: AttentionFacts;
  now: number;
}

/** 单次许可；必须紧邻同步 sink 使用，期间不得 await 或生命周期变更。 */
export interface DeliveryPermit extends Reservation { receiptDeadline: number }

/** 投递前复核结果；拒绝后必须重新 evaluate，不能改写原预留。 */
export type PrepareResult =
  | { status: "ready"; permit: DeliveryPermit }
  | { status: "rejected"; reason: SuppressionReason };

/** 只记录宿主可观察结果，绝不接受 adopted。 */
export type DeliveryResult = "submitted" | "failed" | "unknown";

/** 有界幂等窗口内的提交结果；stale 不重新记账。 */
export type CommitResult =
  | { status: "recorded" | "duplicate"; result: DeliveryResult }
  | { status: "stale" };

/** transition 必须携带捕获 fence 和来源；attention 不能重开预算。 */
export type TransitionEvent =
  | { kind: "activity" | "reload"; fence: PolicyFence; provenance: "external" | "attention"; now: number }
  | { kind: "session"; scope: string; fence: PolicyFence; provenance: "external" | "attention"; now: number };

/** 旧回调的 lifecycle 变更无效而非重新武装。 */
export type TransitionResult =
  | { status: "applied"; fence: PolicyFence }
  | { status: "ignored"; reason: "closed" | "stale-fence" | "self-trigger" };
