/** 单次投递许可与回执；这里不调用 sink，不承诺外部 exactly-once。 */
import type { CommitResult, DeliveryPermit, DeliveryResult, PrepareInput, PrepareResult, SuppressionReason } from "./contracts.js";
import { anchorReason, fenceReason, selectAction } from "./decision.js";
import { anchorKey, copy, sameFence, validatePermit, validatePrepare } from "./input-validation.js";
import { charge, ledgerReason } from "./ledger.js";
import { advance, log, type Pending, type Runtime } from "./runtime.js";
import { integer, member, text, until } from "./validation.js";

function prepareReason(runtime: Runtime, pending: Pending, input: PrepareInput): SuppressionReason | undefined {
  const { reservation, candidate } = pending;
  const settings = runtime.profile.settings;
  const lifecycle = fenceReason(runtime, candidate);
  if (lifecycle) return lifecycle;
  if (!sameFence(runtime.fence, input.fence)) return "stale-fence";
  if (settings.mode !== "emit") return "off";
  const invalidAnchor = anchorReason(candidate, input.anchor, settings, input.now);
  if (invalidAnchor) return invalidAnchor;
  if (anchorKey(input.anchor!) !== anchorKey(reservation.anchor)) return "anchor-changed";
  const action = selectAction(input.facts, settings);
  if (action !== "reanchor" && action !== "wake") return action;
  if (action !== reservation.action) return "no-opportunity";
  if (runtime.pending.size + runtime.awaiting.size >= settings.maxPending) return "pending-capacity";
  return ledgerReason(runtime.real, input.anchor!, action, settings, input.now);
}

/** 重新校验所有门槛并消耗预留；失败也不允许重复 prepare 同一 id。 */
export function prepareDelivery(runtime: Runtime, id: string, input: PrepareInput): PrepareResult {
  text(id, "reservation.id", 4096);
  validatePrepare(input);
  advance(runtime, input.now);
  const pending = runtime.pending.get(id);
  runtime.pending.delete(id);
  const reason = !runtime.active ? "closed" : !pending ? "stale-reservation" : prepareReason(runtime, pending, input);
  if (reason) {
    log(runtime, { event: "prepare", action: "silent", reason,
      ...(input.anchor ? { anchor: input.anchor } : {}), facts: input.facts });
    return { status: "rejected", reason };
  }
  const settings = runtime.profile.settings;
  const permit: DeliveryPermit = { ...pending!.reservation, anchor: copy(input.anchor!),
    expiresAt: Math.min(pending!.reservation.expiresAt, input.anchor!.expiresAt ?? Number.MAX_SAFE_INTEGER),
    receiptDeadline: until(input.now, settings.reservationTtlMs) };
  charge(runtime.real, input.anchor!, permit.action, settings, input.now);
  runtime.awaiting.set(id, copy(permit));
  log(runtime, { event: "prepare", action: permit.action, reason: "attempt", anchor: input.anchor!, facts: input.facts });
  return { status: "ready", permit: copy(permit) };
}

function samePermit(a: DeliveryPermit, b: DeliveryPermit): boolean {
  return a.id === b.id && sameFence(a.fence, b.fence) && anchorKey(a.anchor) === anchorKey(b.anchor)
    && a.anchor.sizeBytes === b.anchor.sizeBytes && a.anchor.expiresAt === b.anchor.expiresAt
    && a.action === b.action && a.expiresAt === b.expiresAt && a.receiptDeadline === b.receiptDeadline;
}

/** 记录真实可观察回执；冲突显式报错，过期或淘汰 id 始终 stale。 */
export function commitDelivery(runtime: Runtime, permit: DeliveryPermit, result: DeliveryResult, now: number): CommitResult {
  validatePermit(permit);
  member(result, ["submitted", "failed", "unknown"], "delivery result");
  integer(now, "now");
  advance(runtime, now);
  if (!runtime.active || !sameFence(runtime.fence, permit.fence)) return { status: "stale" };
  const retained = runtime.receipts.get(permit.id);
  if (retained && samePermit(retained.permit, permit)) {
    if (retained.result !== result) throw new Error("conflicting delivery receipt");
    return { status: "duplicate", result };
  }
  const pending = runtime.awaiting.get(permit.id);
  if (!pending || !samePermit(pending, permit)) return { status: "stale" };
  runtime.awaiting.delete(permit.id);
  const settings = runtime.profile.settings;
  runtime.receipts.set(permit.id, { permit: copy(permit), result, retainedUntil: until(now, settings.reservationTtlMs) });
  while (runtime.receipts.size > settings.maxLogEntries) runtime.receipts.delete(runtime.receipts.keys().next().value!);
  log(runtime, { event: "commit", action: permit.action, reason: "receipt", anchor: permit.anchor, delivery: result });
  return { status: "recorded", result };
}
