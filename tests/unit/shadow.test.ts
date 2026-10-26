import assert from "node:assert/strict";
import test from "node:test";
import { anchor, config, input, makeCore, prepare, reserve } from "../support/fixtures.js";

test("shadow 只返回 silent/wouldAction，消耗独立模拟预算，无许可或 submitted", () => {
  const core = makeCore({ mode: "shadow", maxAttemptsPerEpoch: 1, maxWakePerEpoch: 1 });
  assert.deepEqual(core.evaluate(input(core)), {
    kind: "silent", reason: "shadow", disposition: "drop", wouldAction: "reanchor",
  });
  assert.equal(core.getState().shadow.attempts, 1);
  assert.equal(core.getState().real.attempts, 0);
  assert.equal(core.getState().pendingReservations, 0);
  assert.equal(prepare(core, "fake").status, "rejected");
  assert.equal(core.evaluate(input(core, 10, anchor("rules"))).reason, "budget");
  assert.equal(core.getState().logs.some(row => row.delivery === "submitted"), false);
});

test("shadow 从零开始，不是当前 emit 预算反事实；来回切换真实账本不清零", () => {
  const core = makeCore({ maxAttemptsPerEpoch: 1, maxWakePerEpoch: 1 });
  assert.equal(prepare(core, reserve(core).id).status, "ready");
  core.applyConfig(config({ mode: "shadow", maxAttemptsPerEpoch: 1, maxWakePerEpoch: 1 }));
  assert.equal(core.getState().shadow.attempts, 0);
  assert.equal(core.evaluate(input(core)).reason, "shadow");
  assert.equal(core.getState().shadow.attempts, 1);
  assert.equal(core.getState().real.attempts, 1);
  core.applyConfig(config({ mode: "emit", maxAttemptsPerEpoch: 1, maxWakePerEpoch: 1 }));
  assert.equal(core.getState().shadow.attempts, 0);
  assert.equal(core.getState().real.attempts, 1);
  assert.equal(core.getState().pendingReservations, 0);
  assert.equal(core.evaluate(input(core, 50, anchor("rules"))).reason, "budget");
});

test("shadow→emit 丢弃历史候选；相同输入需新 fence 显式重评估", () => {
  const core = makeCore({ mode: "shadow" });
  const old = input(core);
  core.evaluate(old);
  core.applyConfig(config());
  assert.equal(core.getState().pendingReservations, 0);
  assert.equal(core.evaluate(old).reason, "stale-fence");
  assert.equal(core.evaluate(input(core)).kind, "reanchor");
  assert.equal(core.getState().real.attempts, 0);
});

test("shadow 同样保留去重/冷却，不伪造机械负例的 wouldAction", () => {
  const core = makeCore({ mode: "shadow" });
  const negative = core.evaluate(input(core, 0, anchor(), { evidenceCount: 0 }));
  assert.equal("wouldAction" in negative, false);
  core.evaluate(input(core));
  assert.equal(core.evaluate(input(core, 1)).reason, "duplicate");
  assert.equal(core.evaluate(input(core, 1, anchor("rules"))).reason, "cooldown");
});
