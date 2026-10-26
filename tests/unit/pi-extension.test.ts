import assert from "node:assert/strict";
import test from "node:test";
import { piExtensionFixture } from "../support/pi-extension-fixture.js";

const boundary = { outcome: "completed", continue: false,
  context: { pendingMessages: [], canContinue: true } };

test("用户 run 经 before_agent_start/context 产生请求级 reanchor", () => {
  const fixture = piExtensionFixture();
  fixture.fire("session_start", {});
  fixture.fire("before_agent_start", { messageType: "user" });
  const result = fixture.fire("context", { messages: [] }) as { messages: Array<Record<string, unknown>> };
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0]!.customType, "pi-agent-recall.reanchor.v1");
  assert.equal(fixture.traces.some(row => row.event === "reanchor" && row.delivered === true), true);
});

test("recall custom run 标记 attention，不再次 reanchor", () => {
  const fixture = piExtensionFixture();
  fixture.fire("session_start", {});
  fixture.fire("before_agent_start", { messageType: "custom",
    message: { customType: "pi-agent-recall.wake.v1" } });
  assert.equal(fixture.fire("context", { messages: [] }), undefined);
  assert.equal(fixture.traces.some(row => row.reason === "self-trigger"), true);
});

test("同一外部事件只推进一次 epoch，正常内部阶段不重开预算", () => {
  const fixture = piExtensionFixture();
  fixture.fire("session_start", {});
  const input = { type: "input" };
  fixture.fire("input", input);
  fixture.fire("input", input);
  fixture.fire("agent_start", {});
  fixture.fire("turn_start", {});
  const transitions = fixture.traces.filter(row => row.event === "activity");
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.fence?.epoch, 1);
});

test("wake 返回 continuation，shutdown 后旧事件 fail closed", () => {
  const fixture = piExtensionFixture();
  fixture.fire("session_start", {});
  const result = fixture.fire("agent_before_settle", boundary) as { continue: boolean };
  assert.equal(result.continue, true);
  fixture.fire("session_shutdown", {});
  assert.equal(fixture.fire("context", { messages: [] }), undefined);
  assert.equal(fixture.traces.at(-1)?.reason, "closed");
});

test("真正 shutdown/start 重建使用新 incarnation，compact/tree 仅推进同实例 generation", () => {
  const fixture = piExtensionFixture(["runtime-1", "runtime-2"]);
  fixture.fire("session_start", {});
  fixture.fire("session_before_compact", {});
  assert.equal(fixture.traces.filter(row => row.event === "reload").at(-1)?.fence?.incarnation, "runtime-1");
  assert.equal(fixture.traces.filter(row => row.event === "reload").at(-1)?.fence?.generation, 1);
  fixture.fire("session_shutdown", { reason: "reload" });
  fixture.fire("session_start", { reason: "reload" });
  const runtimes = fixture.traces.filter(row => row.event === "runtime");
  assert.deepEqual(runtimes.map(row => row.fence?.incarnation), ["runtime-1", "runtime-2"]);
  assert.equal(runtimes[1]?.fence?.generation, 0);
});
