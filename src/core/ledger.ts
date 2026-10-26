/** 账本不拥有时钟或宿主；真实与 shadow 实例完全分离。 */
import type { LedgerState } from "./runtime-types.js";
import type { ActionKind, AnchorMetadata, SuppressionReason } from "./contracts.js";
import type { PolicySettings } from "./profile-types.js";
import { anchorKey } from "./input-validation.js";
import { until } from "./validation.js";

/** 内部有界去重账本，外部只读取 LedgerState。 */
export interface Ledger {
  attempts: number;
  wakeAttempts: number;
  lastAttemptAt: number | null;
  lastWakeAt: number | null;
  dedupe: Map<string, number>;
}

/** 新账本从零开始，不继承另一种模式的消费。 */
export function createLedger(): Ledger {
  return { attempts: 0, wakeAttempts: 0, lastAttemptAt: null, lastWakeAt: null, dedupe: new Map() };
}

/** 显式时刻清理已失效条目，不驱逐仍有效的去重记录。 */
export function pruneLedger(ledger: Ledger, now: number): void {
  for (const [key, expiresAt] of ledger.dedupe) if (expiresAt <= now) ledger.dedupe.delete(key);
}

/** 诊断输出不泄露可变 Map。 */
export function ledgerState(ledger: Ledger): LedgerState {
  return { attempts: ledger.attempts, wakeAttempts: ledger.wakeAttempts,
    lastAttemptAt: ledger.lastAttemptAt, lastWakeAt: ledger.lastWakeAt, dedupeEntries: ledger.dedupe.size };
}

/** evaluate 与 prepare 共用同一完整账本门槛，避免签发与投递间绕限额。 */
export function ledgerReason(ledger: Ledger, anchor: AnchorMetadata, action: ActionKind,
  settings: PolicySettings, now: number): SuppressionReason | undefined {
  if (ledger.dedupe.has(anchorKey(anchor))) return "duplicate";
  if (ledger.attempts >= settings.maxAttemptsPerEpoch) return "budget";
  if (action === "wake" && ledger.wakeAttempts >= settings.maxWakePerEpoch) return "wake-budget";
  if (ledger.lastAttemptAt !== null && now < until(ledger.lastAttemptAt, settings.cooldownMs)) return "cooldown";
  if (action === "wake" && ledger.lastWakeAt !== null && now < until(ledger.lastWakeAt, settings.wakeCooldownMs)) return "wake-cooldown";
  if (ledger.dedupe.size >= settings.maxDedupeEntries) return "dedupe-capacity";
  return undefined;
}

/** 签发许可即保守记一次尝试，失败或 unknown 没有退款路径。 */
export function charge(ledger: Ledger, anchor: AnchorMetadata, action: ActionKind, settings: PolicySettings, now: number): void {
  ledger.attempts++;
  ledger.lastAttemptAt = now;
  if (action === "wake") { ledger.wakeAttempts++; ledger.lastWakeAt = now; }
  if (settings.dedupeMs > 0) ledger.dedupe.set(anchorKey(anchor), until(now, settings.dedupeMs));
}
