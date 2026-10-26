import assert from "node:assert/strict";
import test from "node:test";
import { makeCore } from "../support/fixtures.js";
import { createRecallRuntime } from "../../src/pi/recall-runtime.js";

const snapshot = { ref: { provider: "roles", id: "current" }, version: "v1", content: "ANCHOR_ONE" };
const boundary = { outcome: "completed" as const, continue: false,
  context: { pendingMessages: [], canContinue: false } };

test("reanchor 返回一次请求级 custom 消息并记 submitted", () => {
  const core = makeCore({ cooldownMs: 0, dedupeMs: 0 });
  const runtime = createRecallRuntime({ core, anchors: { current: () => snapshot } });
  runtime.beginRun("external", 0);
  const result = runtime.reanchor([], 0);
  assert.equal(result.delivered, true);
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.messages[0], { role: "custom", customType: "pi-agent-recall.reanchor.v1",
    content: "ANCHOR_ONE", display: false, timestamp: 0 });
  assert.equal(core.getState().real.attempts, 1);
  assert.equal(core.getState().logs.at(-1)!.delivery, "submitted");
});

test("prepare 重读版本变化时拒绝旧正文", () => {
  const core = makeCore();
  const versions = ["v1", "v2"];
  let reads = 0;
  const runtime = createRecallRuntime({ core, anchors: { current: () => ({ ...snapshot,
    version: versions[Math.min(reads++, 1)]!, content: versions[Math.min(reads - 1, 1)]! }) } });
  runtime.beginRun("external", 0);
  const result = runtime.reanchor([], 0);
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "anchor-changed");
  assert.deepEqual(result.messages, []);
  assert.equal(core.getState().real.attempts, 0);
});

test("wake 仅在最终无 continuation 边界返回一次 custom_message", () => {
  const core = makeCore();
  const runtime = createRecallRuntime({ core, anchors: { current: () => snapshot } });
  const result = runtime.wake(boundary, 0);
  assert.equal(result.delivered, true);
  assert.deepEqual(result.result, { entries: [{ type: "custom_message", customType: "pi-agent-recall.wake.v1",
    content: "ANCHOR_ONE", display: false }], continue: true });
  assert.equal(core.getState().real.wakeAttempts, 1);
});

test("边界已含 recall wake 时不得依赖预算再次自激", () => {
  const core = makeCore({ cooldownMs: 0, wakeCooldownMs: 0, dedupeMs: 0, maxAttemptsPerEpoch: 3, maxWakePerEpoch: 2 });
  const runtime = createRecallRuntime({ core, anchors: { current: () => snapshot } });
  assert.equal(runtime.wake(boundary, 0).delivered, true);
  const continued = { ...boundary, context: { ...boundary.context, contextMessages: [
    { role: "custom", customType: "pi-agent-recall.wake.v1" },
  ] } };
  assert.equal(runtime.wake(continued, 1).delivered, false);
  assert.equal(runtime.wake(continued, 1).reason, "self-trigger");
  assert.equal(core.getState().real.wakeAttempts, 1);
});

test("历史 wake 后的新外部 user run 仍可重新评估 wake", () => {
  const core = makeCore({ cooldownMs: 0, wakeCooldownMs: 0, dedupeMs: 0, maxAttemptsPerEpoch: 3, maxWakePerEpoch: 2 });
  const runtime = createRecallRuntime({ core, anchors: { current: () => snapshot } });
  assert.equal(runtime.wake(boundary, 0).delivered, true);
  const external = { ...boundary, context: { ...boundary.context, contextMessages: [
    { role: "custom", customType: "pi-agent-recall.wake.v1" },
    { role: "assistant", content: "done" },
    { role: "user", content: "new external request" },
    { role: "assistant", content: "done again" },
  ] } };
  assert.equal(runtime.wake(external, 1).delivered, true);
  assert.equal(core.getState().real.wakeAttempts, 2);
});

test("已有 continuation、非完成状态和 attention 自激均不投递", () => {
  for (const current of [{ ...boundary, continue: true }, { ...boundary, outcome: "aborted" as const },
    { ...boundary, context: { pendingMessages: [{}], canContinue: true } }]) {
    const core = makeCore();
    const runtime = createRecallRuntime({ core, anchors: { current: () => snapshot } });
    assert.equal(runtime.wake(current, 0).delivered, false);
    assert.equal(core.getState().real.attempts, 0);
  }
  const core = makeCore();
  const runtime = createRecallRuntime({ core, anchors: { current: () => snapshot } });
  runtime.beginRun("attention", 0);
  assert.equal(runtime.reanchor([], 0).delivered, false);
  assert.equal(core.getState().real.attempts, 0);
});

test("同步 sink 失败记 failed、不退款且不自动重试", () => {
  const core = makeCore();
  const runtime = createRecallRuntime({ core, anchors: { current: () => snapshot },
    sink: { accept: () => { throw new Error("sink rejected"); } } });
  const result = runtime.wake(boundary, 0);
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "sink-failed");
  assert.equal(core.getState().real.attempts, 1);
  assert.equal(core.getState().logs.at(-1)!.delivery, "failed");
  assert.equal(runtime.wake(boundary, 0).delivered, false);
  assert.equal(core.getState().real.attempts, 1);
});
