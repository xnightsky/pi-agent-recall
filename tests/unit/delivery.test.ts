import assert from "node:assert/strict";
import test from "node:test";
import type { DeliveryPermit, PolicyCore } from "../../src/core/index.js";
import { anchor, config, facts, input, makeCore, prepare, reserve } from "../support/fixtures.js";

function permit(core: PolicyCore, id: string, now = 0, metadata = anchor()): DeliveryPermit {
  const result = prepare(core, id, now, metadata);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw new Error("not ready");
  return result.permit;
}

test("预留不计尝试；prepare 单次计费，同 ref@version 被阻止", () => {
  const core = makeCore();
  const reservation = reserve(core);
  assert.equal(core.getState().real.attempts, 0);
  assert.equal(core.evaluate(input(core)).kind, "silent");
  const first = permit(core, reservation.id);
  assert.equal(core.getState().real.attempts, 1);
  assert.equal(prepare(core, reservation.id).status, "rejected");
  assert.equal(core.getState().real.attempts, 1);
  assert.deepEqual(core.commitDelivery(first, "submitted", 0), { status: "recorded", result: "submitted" });
  assert.deepEqual(core.commitDelivery(first, "submitted", 0), { status: "duplicate", result: "submitted" });
  assert.throws(() => core.commitDelivery(first, "failed", 0), /conflicting/);
  assert.equal(core.evaluate(input(core, 10)).kind, "silent");
  assert.equal(core.evaluate(input(core, 10, anchor("roles", "current", "v2"))).kind, "reanchor");
});

test("prepare 必须复核当前预算、cooldown 与去重容量", () => {
  for (const [settings, now, reason] of [
    [{ maxAttemptsPerEpoch: 1, maxWakePerEpoch: 1 }, 10, "budget"],
    [{ cooldownMs: 20 }, 10, "cooldown"],
    [{ maxDedupeEntries: 1 }, 10, "dedupe-capacity"],
  ] as const) {
    const core = makeCore(settings);
    const first = reserve(core, 0, anchor("roles", "one"));
    const second = reserve(core, 0, anchor("rules", "two"));
    permit(core, first.id, 0, anchor("roles", "one"));
    assert.deepEqual(prepare(core, second.id, now, anchor("rules", "two")), { status: "rejected", reason });
    assert.equal(core.getState().real.attempts, 1);
  }
});

test("prepare 拒绝 v1→v2、删除、到期、能力丢失和机会改变", () => {
  const changes = [
    { anchor: anchor("roles", "current", "v2"), facts: facts(), now: 0 },
    { facts: facts(), now: 0 },
    { anchor: { ...anchor(), expiresAt: 1 }, facts: facts(), now: 1 },
    { anchor: anchor(), facts: facts({ capabilities: { reanchor: false, wake: true } }), now: 0 },
    { anchor: anchor(), facts: facts({ nextRequest: "none", activity: "settled", continuation: "none" }), now: 0 },
    { anchor: anchor(), facts: facts({ evidenceCount: 0 }), now: 0 },
  ];
  for (const change of changes) {
    const core = makeCore();
    const reservation = reserve(core);
    assert.equal(core.prepareDelivery(reservation.id, { ...change, fence: core.getState().fence }).status, "rejected");
    assert.equal(core.getState().real.attempts, 0);
    assert.equal(core.getState().pendingReservations, 0);
  }
});

test("failed/unknown 不退款，配置变更保留真实预算与去重", () => {
  for (const result of ["failed", "unknown"] as const) {
    const core = makeCore({ maxAttemptsPerEpoch: 1, maxWakePerEpoch: 1 });
    const ticket = permit(core, reserve(core).id);
    core.commitDelivery(ticket, result, 0);
    core.applyConfig(config({ maxAttemptsPerEpoch: 1, maxWakePerEpoch: 1 }));
    assert.equal(core.getState().real.attempts, 1);
    assert.equal(core.evaluate(input(core, 10, anchor("rules"))).kind, "silent");
    assert.deepEqual(core.commitDelivery(ticket, result, 10), { status: "stale" });
    const old = core.getState().fence;
    core.transition({ kind: "activity", fence: old, provenance: "external", now: 10 });
    assert.equal(core.getState().real.attempts, 0);
    assert.equal(core.evaluate(input(core, 10)).kind, "silent");
    assert.equal(core.transition({ kind: "activity", fence: old, provenance: "external", now: 10 }).status, "ignored");
    assert.equal(core.evaluate(input(core, 10, anchor("rules"))).kind, "reanchor");
  }
});

test("回执超时仅在显式 now 调用惰性判 unknown，不重试", () => {
  const core = makeCore({ reservationTtlMs: 10 });
  const ticket = permit(core, reserve(core).id);
  assert.equal(core.getState().pendingReceipts, 1);
  assert.equal(core.getState().real.attempts, 1);
  core.evaluate(input(core, 10, anchor("rules"), { evidenceCount: 0 }));
  assert.equal(core.getState().pendingReceipts, 0);
  assert.equal(core.getState().logs.some(row => row.event === "timeout" && row.delivery === "unknown"), true);
  assert.deepEqual(core.commitDelivery(ticket, "submitted", 10), { status: "stale" });
  assert.equal(core.getState().real.attempts, 1);
});

test("回执数量/时间有界；淘汰后 stale，不能复活票据", () => {
  const core = makeCore({ maxLogEntries: 1, cooldownMs: 0, dedupeMs: 0, reservationTtlMs: 10 });
  const first = permit(core, reserve(core).id);
  core.commitDelivery(first, "submitted", 0);
  const second = permit(core, reserve(core, 1, anchor("rules")).id, 1, anchor("rules"));
  core.commitDelivery(second, "failed", 1);
  assert.equal(core.getState().retainedReceipts, 1);
  assert.deepEqual(core.commitDelivery(first, "submitted", 1), { status: "stale" });
  assert.deepEqual(core.commitDelivery(second, "failed", 11), { status: "stale" });
  assert.equal(core.getState().real.attempts, 2);
});

test("maxPending 同时限制预留和待回执，deadline/TTL 到期释放", () => {
  const core = makeCore({ maxPending: 1, reservationTtlMs: 10, cooldownMs: 0, dedupeMs: 0 });
  const ticket = permit(core, reserve(core).id);
  assert.equal(core.evaluate(input(core, 0, anchor("rules"))).kind, "silent");
  core.commitDelivery(ticket, "submitted", 0);
  const pending = reserve(core, 0, anchor("rules"));
  assert.equal(prepare(core, pending.id, 10, anchor("rules")).status, "rejected");
  assert.equal(core.getState().real.attempts, 1);
});

test("不同 incarnation、close 和伪造 permit 回执无效", () => {
  const core = makeCore();
  const ticket = permit(core, reserve(core).id);
  const other = makeCore({}, "other");
  assert.deepEqual(other.commitDelivery(ticket, "submitted", 0), { status: "stale" });
  assert.deepEqual(core.commitDelivery({ ...ticket, action: "wake" }, "submitted", 0), { status: "stale" });
  assert.equal(core.getState().pendingReceipts, 1);
  core.close();
  assert.deepEqual(core.commitDelivery(ticket, "submitted", 0), { status: "stale" });
});

test("wake 过期更短且具独立次数、频率门槛，prepare 重查活动", () => {
  const core = makeCore({ wakeTtlMs: 5, maxAttemptsPerEpoch: 3, maxWakePerEpoch: 1 });
  const wakeFacts = facts({ nextRequest: "none", activity: "settled", continuation: "none" });
  const candidate = input(core); candidate.candidate.facts = wakeFacts;
  const first = core.evaluate(candidate);
  assert.equal(first.kind, "wake");
  assert.equal(first.reservation.expiresAt, 5);
  const staleActivity = core.prepareDelivery(first.reservation.id, { fence: core.getState().fence, now: 0, anchor: anchor(), facts: { ...wakeFacts, activity: "active" } });
  assert.equal(staleActivity.status, "rejected");
  const second = core.evaluate(candidate);
  if (second.kind === "silent") throw new Error("expected wake");
  const ready = core.prepareDelivery(second.reservation.id, { fence: core.getState().fence, now: 0, anchor: anchor(), facts: wakeFacts });
  assert.equal(ready.status, "ready");
  assert.equal(core.getState().real.wakeAttempts, 1);
  assert.equal(core.evaluate(input(core, 20, anchor("rules"), wakeFacts)).kind, "silent");
});
