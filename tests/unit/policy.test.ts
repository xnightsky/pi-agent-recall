import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../../src/core/index.js";
import { anchor, config, input, makeCore } from "../support/fixtures.js";

test("factory 默认 off，所有诊断快照与外部输入隔离", () => {
  assert.equal(typeof (api as Record<string, unknown>).createPolicyCore, "function");
  const factory = (api as Record<string, Function>).createPolicyCore!;
  const core = factory({ scope: "s", owner: "o", incarnation: "i" });
  const candidate = input(core);
  assert.equal(core.evaluate(candidate).reason, "off");
  const snapshot = core.getState();
  snapshot.fence.scope = "forged";
  snapshot.profile.settings.mode = "emit";
  snapshot.logs.length = 0;
  assert.equal(core.getState().fence.scope, "s");
  assert.equal(core.getState().profile.settings.mode, "off");
  assert.equal(core.getState().logs.length, 1);
});

test("已有请求优先 reanchor，不支持或关闭时不偷换 wake", () => {
  for (const [settings, capabilities, want] of [
    [{}, { reanchor: true, wake: true }, "reanchor"],
    [{}, { reanchor: false, wake: true }, "silent"],
    [{ allowReanchor: false }, { reanchor: true, wake: true }, "silent"],
  ] as const) {
    const core = makeCore(settings);
    assert.equal(core.evaluate(input(core, 0, anchor(), { capabilities })).kind, want);
  }
});

test("wake 必须 settled、无下一请求、明确无 continuation", () => {
  for (const [nextRequest, activity, continuation, want] of [
    ["none", "settled", "none", "wake"],
    ["none", "settled", "present", "silent"],
    ["none", "settled", "unknown", "silent"],
    ["none", "active", "none", "silent"],
    ["unknown", "settled", "none", "silent"],
    ["none", "unknown", "none", "silent"],
  ] as const) {
    const core = makeCore();
    assert.equal(core.evaluate(input(core, 0, anchor(), { nextRequest, activity, continuation })).kind, want);
  }
});

test("无锚点、过期、大小超限、无证据和 attention 自激必须沉默", () => {
  const core = makeCore({ maxAnchorBytes: 20 });
  const missing = input(core); delete missing.anchor;
  assert.equal(core.evaluate(missing).kind, "silent");
  assert.equal(core.evaluate(input(core, 0, { ...anchor(), expiresAt: 0 })).kind, "silent");
  assert.equal(core.evaluate(input(core, 0, { ...anchor(), sizeBytes: 21 })).kind, "silent");
  assert.equal(core.evaluate(input(core, 0, anchor(), { evidenceCount: 0 })).kind, "silent");
  const self = input(core); self.candidate.provenance = "attention";
  assert.equal(core.evaluate(self).kind, "silent");
  assert.equal(core.getState().pendingReservations, 0);
});

test("有 deadline 才能 defer，core 不保存补发队列", () => {
  const core = makeCore();
  const waiting = input(core, 1, anchor(), { nextRequest: "none", activity: "active" });
  assert.deepEqual(core.evaluate(waiting), { kind: "silent", reason: "no-opportunity", disposition: "drop" });
  waiting.candidate.decisionDeadline = 20;
  assert.deepEqual(core.evaluate(waiting), { kind: "silent", reason: "no-opportunity", disposition: "defer" });
  assert.equal(core.getState().pendingReservations, 0);
  waiting.now = 20;
  assert.equal(core.evaluate(waiting).kind, "silent");
  assert.equal(core.getState().real.attempts, 0);
});

test("配置原子更新；模型未知回 off，旧候选与旧预留失效", () => {
  const core = makeCore();
  const candidate = input(core);
  const decision = core.evaluate(candidate);
  assert.notEqual(decision.kind, "silent");
  const before = core.getState();
  assert.throws(() => core.applyConfig(config({ cooldownMs: NaN })), /cooldownMs/);
  assert.deepEqual(core.getState(), before);
  core.applyConfig({ context: { ...config().context, model: "unknown" } });
  assert.equal(core.getState().profile.settings.mode, "off");
  assert.equal(core.getState().pendingReservations, 0);
  assert.deepEqual(core.evaluate(candidate), { kind: "silent", reason: "stale-fence", disposition: "drop" });
});

test("完整 fence、A→B→A 与 close 阻止旧实例和旧 callback", () => {
  const core = makeCore();
  const old = input(core);
  const other = makeCore({}, "runtime-2");
  assert.equal(other.evaluate(old).kind, "silent");
  for (const scope of ["session-b", "session-a"]) {
    const result = core.transition({ kind: "session", scope, fence: core.getState().fence, provenance: "external", now: 0 });
    assert.equal(result.status, "applied");
  }
  assert.equal(core.getState().fence.generation, 2);
  assert.equal(core.evaluate(old).kind, "silent");
  assert.equal(core.transition({ kind: "activity", fence: old.candidate.fence, provenance: "external", now: 0 }).status, "ignored");
  assert.equal(core.transition({ kind: "activity", fence: core.getState().fence, provenance: "attention", now: 0 }).status, "ignored");
  core.close();
  assert.equal(core.evaluate(input(core)).kind, "silent");
  assert.equal(core.getState().active, false);
  assert.throws(() => core.applyConfig(config()), /closed/);
});
