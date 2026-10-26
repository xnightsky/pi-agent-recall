import assert from "node:assert/strict";
import test from "node:test";
import { anchor, input, makeCore } from "../support/fixtures.js";

test("时间与计数拒绝非安全整数，时钟不能倒退", () => {
  const core = makeCore();
  for (const now of [-1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => core.evaluate(input(core, now)), /safe integer/);
  }
  core.evaluate(input(core, 10));
  assert.throws(() => core.evaluate(input(core, 9)), /backwards/);
  const bad = input(core, 10);
  bad.candidate.observedAt = 11;
  assert.throws(() => core.evaluate(bad), /observedAt/);
  bad.candidate.observedAt = 10;
  bad.candidate.facts.evidenceCount = NaN;
  assert.throws(() => core.evaluate(bad), /evidenceCount/);
});

test("拒绝正文、未知字段、访问器、无界字符串和未知事件", () => {
  const core = makeCore();
  const original = core.getState();
  const bad = input(core);
  Object.assign(bad.anchor!, { content: "private text" });
  assert.throws(() => core.evaluate(bad), /unknown field/);
  let reads = 0;
  const accessor = input(core);
  Object.defineProperty(accessor.candidate, "observedAt", { get: () => { reads++; return 0; } });
  assert.throws(() => core.evaluate(accessor), /accessor/);
  assert.equal(reads, 0);
  assert.throws(() => core.evaluate(input(core, 0, anchor("x".repeat(257)))), /bounded/);
  assert.throws(() => core.transition({ kind: "bogus" } as never), /unsupported/);
  assert.deepEqual(core.getState(), original);
});

test("引用键结构化编码，不因分隔符导致不同锚点冲突", () => {
  const core = makeCore();
  assert.equal(core.evaluate(input(core, 0, anchor("a|b", "c"))).kind, "reanchor");
  assert.equal(core.evaluate(input(core, 0, anchor("a", "b|c"))).kind, "reanchor");
  assert.equal(core.getState().pendingReservations, 2);
});

test("日志限制条数且不包含正文；状态修改不能改变内部预留", () => {
  const core = makeCore({ maxLogEntries: 2 });
  for (let i = 0; i < 4; i++) core.evaluate(input(core, i, anchor("roles", String(i))));
  assert.equal(core.getState().logs.length, 2);
  const state = core.getState();
  state.logs[0]!.profile.settings.mode = "off";
  state.logs[0]!.anchor!.ref.id = "forged";
  assert.equal(core.getState().profile.settings.mode, "emit");
  assert.notEqual(core.getState().logs[0]!.anchor!.ref.id, "forged");
  assert.equal(state.logs[0]!.adoption, "unobserved");
});
