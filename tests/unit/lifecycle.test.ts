import assert from "node:assert/strict";
import test from "node:test";
import { anchor, config, facts, input, makeCore, prepare, reserve } from "../support/fixtures.js";

test("失活待回执的日志保持旧 profile/fence 归因而不标 adopted", () => {
  const core = makeCore();
  const reservation = reserve(core);
  assert.equal(prepare(core, reservation.id).status, "ready");
  const before = core.getState();
  core.applyConfig({ ...config(), context: { ...config().context, model: "new-model" } });
  const invalidated = core.getState().logs.find(row => row.reason === "lifecycle-invalidated")!;
  assert.deepEqual(invalidated.fence, before.fence);
  assert.equal(invalidated.profile.context.model, before.profile.context.model);
  assert.equal(invalidated.delivery, "unknown");
  assert.equal(invalidated.adoption, "unobserved");
});

test("活动重开阶段预算但不重置 wake cooldown 或去重", () => {
  const core = makeCore({ dedupeMs: 5, cooldownMs: 0, wakeCooldownMs: 20 });
  const wake = { nextRequest: "none", activity: "settled", continuation: "none" } as const;
  const decision = core.evaluate(input(core, 0, anchor(), wake));
  assert.equal(decision.kind, "wake");
  if (!("reservation" in decision)) throw new Error("missing reservation");
  const result = prepare(core, decision.reservation.id, 0, anchor(), wake);
  assert.equal(result.status, "ready");
  core.transition({ kind: "activity", fence: core.getState().fence, provenance: "external", now: 10 });
  const blocked = core.evaluate(input(core, 10, anchor(), wake));
  assert.equal(blocked.kind, "silent");
  assert.equal(blocked.reason, "wake-cooldown");
  assert.equal(core.evaluate(input(core, 20, anchor(), wake)).kind, "wake");
});

test("准备与回执非法数据不消耗预留；完整 fence 每一字段都复核", () => {
  for (const field of ["scope", "owner", "incarnation", "revision", "generation", "epoch"] as const) {
    const core = makeCore();
    const reservation = reserve(core);
    const fence = { ...core.getState().fence, [field]: typeof reservation.fence[field] === "string" ? "wrong" : 9 };
    assert.equal(core.prepareDelivery(reservation.id, { fence, anchor: anchor(), facts: facts(), now: 0 } as never).status, "rejected");
    assert.equal(core.getState().real.attempts, 0);
  }
  const core = makeCore();
  const reservation = reserve(core);
  assert.throws(() => core.prepareDelivery(reservation.id, { fence: core.getState().fence, anchor: anchor(), facts: facts(), now: NaN }));
  assert.equal(core.getState().pendingReservations, 1);
  const ready = prepare(core, reservation.id);
  if (ready.status !== "ready") throw new Error("expected ready");
  assert.throws(() => core.commitDelivery(ready.permit, "adopted" as never, 0), /unsupported/);
  assert.equal(core.getState().pendingReceipts, 1);
});

test("同版本 expiry 收紧后许可也收紧；MAX_SAFE 时间不产生已过期预留", () => {
  const core = makeCore();
  const reservation = reserve(core);
  const result = prepare(core, reservation.id, 0, { ...anchor(), expiresAt: 5 });
  if (result.status !== "ready") throw new Error("expected ready");
  assert.equal(result.permit.expiresAt, 5);
  const boundary = makeCore();
  const decision = boundary.evaluate(input(boundary, Number.MAX_SAFE_INTEGER));
  assert.equal(decision.kind, "silent");
  assert.equal(boundary.getState().pendingReservations, 0);
});

test("prepare 的原期限不因快照续期被延长，reload 失活旧候选", () => {
  const core = makeCore();
  const request = input(core, 0, { ...anchor(), expiresAt: 5 });
  request.candidate.decisionDeadline = 3;
  const decision = core.evaluate(request);
  if (decision.kind === "silent") throw new Error("expected reservation");
  assert.equal(decision.reservation.expiresAt, 3);
  assert.equal(prepare(core, decision.reservation.id, 3, { ...anchor(), expiresAt: 100 }).status, "rejected");
  const old = input(core, 3);
  core.transition({ kind: "reload", fence: core.getState().fence, provenance: "external", now: 3 });
  assert.equal(core.evaluate(old).reason, "stale-fence");
});
