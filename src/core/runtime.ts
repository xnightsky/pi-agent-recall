/** 单实例运行态；无全局 registry，无 I/O，无正文。 */
import type { AttentionCandidate, Reservation, PolicyFence, DeliveryPermit, DeliveryResult } from "./contracts.js";
import type { AttentionConfig, ResolvedProfile } from "./profile-types.js";
import type { DecisionLog, PolicyCoreOptions, PolicyState } from "./runtime-types.js";
import { copy } from "./input-validation.js";
import { createLedger, ledgerState, pruneLedger, type Ledger } from "./ledger.js";
import { resolveProfile } from "./profile.js";
import { integer, object, text } from "./validation.js";

/** 预留记录保留原始候选期限，但不持有补发队列。 */
export interface Pending { reservation: Reservation; candidate: AttentionCandidate }

/** 完成回执仅在有界幂等窗口内保存。 */
export interface Receipt { permit: DeliveryPermit; result: DeliveryResult; retainedUntil: number }

/** 内部可变状态只由一个 PolicyCore 实例持有。 */
export interface Runtime {
  active: boolean;
  fence: PolicyFence;
  profile: ResolvedProfile;
  now: number;
  sequence: number;
  real: Ledger;
  shadow: Ledger;
  pending: Map<string, Pending>;
  awaiting: Map<string, DeliveryPermit>;
  receipts: Map<string, Receipt>;
  logs: DecisionLog[];
}

const defaultConfig: AttentionConfig = { context: {
  host: "unknown", hostVersion: "unknown", provider: "unknown", model: "unknown",
  modelRevision: "unknown", taskFamily: "unknown", roleTopology: "unknown",
  policyVersion: "unknown", reminderTextVersion: "unknown",
} };

/** 校验组合根身份并初始化 conservative/off。 */
export function createRuntime(options: PolicyCoreOptions): Runtime {
  const data = object(options, "options", ["scope", "owner", "incarnation", "config"]);
  for (const key of ["scope", "owner", "incarnation"]) text(data[key], key);
  const profile = resolveProfile(data.config === undefined ? defaultConfig : data.config as AttentionConfig);
  return { active: true, fence: { scope: options.scope, owner: options.owner, incarnation: options.incarnation,
    revision: 0, generation: 0, epoch: 0 }, profile, now: 0, sequence: 0,
    real: createLedger(), shadow: createLedger(), pending: new Map(), awaiting: new Map(), receipts: new Map(), logs: [] };
}

/** 显式推进并惰性清理；读取状态和 fake clock 本身不执行清理。 */
export function advance(runtime: Runtime, now: number): void {
  integer(now, "now");
  if (now < runtime.now) throw new RangeError("clock moved backwards");
  runtime.now = now;
  pruneLedger(runtime.real, now);
  pruneLedger(runtime.shadow, now);
  for (const [id, item] of runtime.pending) if (item.reservation.expiresAt <= now) runtime.pending.delete(id);
  for (const [id, permit] of runtime.awaiting) {
    if (permit.receiptDeadline > now) continue;
    runtime.awaiting.delete(id);
    log(runtime, { event: "timeout", action: permit.action, reason: "receipt-timeout", anchor: permit.anchor, delivery: "unknown" });
  }
  for (const [id, receipt] of runtime.receipts) if (receipt.retainedUntil <= now) runtime.receipts.delete(id);
}

/** 日志包含归因与规范化事实，不包含正文或任意错误详情。 */
export function log(runtime: Runtime, entry: Pick<DecisionLog, "event" | "action" | "reason"> &
  Partial<Pick<DecisionLog, "anchor" | "facts" | "delivery">>): void {
  runtime.logs.push(copy({ ...entry, at: runtime.now, fence: runtime.fence, profile: runtime.profile,
    adoption: "unobserved", cost: "unobserved" }));
  runtime.logs.splice(0, Math.max(0, runtime.logs.length - runtime.profile.settings.maxLogEntries));
}

/** 返回隔离且可序列化的诊断快照。 */
export function snapshot(runtime: Runtime): PolicyState {
  return copy({ active: runtime.active, fence: runtime.fence, profile: runtime.profile, now: runtime.now,
    pendingReservations: runtime.pending.size, pendingReceipts: runtime.awaiting.size, retainedReceipts: runtime.receipts.size,
    real: ledgerState(runtime.real), shadow: ledgerState(runtime.shadow), logs: runtime.logs });
}

/** 溢出时拒绝推进，禁止回绕复用 fence 或票据。 */
export function increment(value: number): number {
  integer(value, "counter", 0, Number.MAX_SAFE_INTEGER - 1);
  return value + 1;
}

/** 取消旧预留/许可；已记尝试保留，待回执失活显式记录 unknown。 */
export function invalidate(runtime: Runtime): void {
  runtime.pending.clear();
  for (const permit of runtime.awaiting.values()) {
    log(runtime, { event: "timeout", action: permit.action, reason: "lifecycle-invalidated", anchor: permit.anchor, delivery: "unknown" });
  }
  runtime.awaiting.clear();
  runtime.receipts.clear();
}
