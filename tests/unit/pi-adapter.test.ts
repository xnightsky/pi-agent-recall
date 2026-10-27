/** adapter 单元测试：fake 宿主事件 + fake 锚点；零 token，不拉起真实 Pi。 */
import assert from "node:assert/strict";
import test from "node:test";
import { createPolicyCore, type AttentionConfig, type PolicyCore } from "../../src/core/index.js";
import {
  createPiRecallExtension, type PiExtensionApi, type PiRecallTrace,
} from "../../src/pi/extension.js";
import type { PiAnchorSnapshot, PiDeliverySink, PiMessage, PiSettleBoundary } from "../../src/pi/host-types.js";

/** 与宿主版本对齐的虚构归因上下文；不代表任何已标定模型。 */
const context = {
  host: "pi", hostVersion: "1.4.0", provider: "fixture", model: "fake",
  modelRevision: "1", taskFamily: "unit", roleTopology: "single",
  policyVersion: "p1", reminderTextVersion: "t1",
};

/** emit 双动作配置；预算与 TTL 仅供可重复测试。 */
function emitConfig(): AttentionConfig {
  return { context, profiles: [{ id: "emit-all", context, settings: {
    mode: "emit", allowReanchor: true, allowWake: true, minEvidence: 1,
    cooldownMs: 0, wakeCooldownMs: 0, dedupeMs: 60_000,
    maxAttemptsPerEpoch: 4, maxWakePerEpoch: 2, reservationTtlMs: 60_000,
  } }] };
}

/** 已停下且可续跑的 settle 边界；默认最后一条是普通用户消息。 */
function settleBoundary(overrides?: Partial<PiSettleBoundary>): PiSettleBoundary {
  return { outcome: "completed", continue: false,
    context: { pendingMessages: [], canContinue: true,
      contextMessages: [{ role: "user", content: "原始问题" }] }, ...overrides };
}

interface Harness {
  fire(name: string, event?: unknown): unknown;
  traces: PiRecallTrace[];
  sinkCalls: string[];
  cores: PolicyCore[];
  setAnchor(snapshot: PiAnchorSnapshot | undefined): void;
  lastTrace(event: string): PiRecallTrace | undefined;
}

/** 组装显式加载的 extension 与 fake ExtensionAPI；时间恒为 0，事件全部同步。 */
function harness(config: AttentionConfig = emitConfig(), sink?: PiDeliverySink): Harness {
  let snapshot: PiAnchorSnapshot | undefined = {
    ref: { provider: "rules", id: "main" }, version: "1", content: "锚点内容一",
  };
  const traces: PiRecallTrace[] = [];
  const sinkCalls: string[] = [];
  const cores: PolicyCore[] = [];
  const handlers = new Map<string, (event: unknown) => unknown>();
  const pi: PiExtensionApi = { on: (event, handler) => void handlers.set(event, handler) };
  createPiRecallExtension({
    scope: "unit", owner: "unit-owner", config,
    anchors: { current: () => snapshot ? structuredClone(snapshot) : undefined },
    now: () => 0,
    trace: entry => traces.push(entry),
    sink: sink ?? { accept: action => void sinkCalls.push(action) },
    createCore: (incarnation, cfg) => {
      const core = createPolicyCore({ scope: "unit", owner: "unit-owner", incarnation, config: cfg });
      cores.push(core);
      return core;
    },
  })(pi);
  return {
    fire: (name, event) => handlers.get(name)!(event),
    traces, sinkCalls, cores,
    setAnchor: next => { snapshot = next; },
    lastTrace: event => [...traces].reverse().find(entry => entry.event === event),
  };
}

test("reanchor 经 context 注入当前锚点正文并提交 submitted", () => {
  const h = harness();
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  const result = h.fire("context", { messages: [{ role: "user", content: "原始消息" }] }) as { messages: PiMessage[] };
  const appended = result.messages.at(-1) as Record<string, unknown>;
  assert.equal(appended.role, "custom");
  assert.equal(appended.customType, "pi-agent-recall.reanchor.v1");
  assert.equal(appended.content, "锚点内容一");
  assert.equal(appended.display, false);
  assert.deepEqual(h.sinkCalls, ["reanchor"]);
  assert.equal(h.cores[0]!.getState().real.attempts, 1);
  assert.deepEqual(h.lastTrace("reanchor"), { event: "reanchor", delivered: true });
});

test("锚点缺失时不投递且原消息透传", () => {
  const h = harness();
  h.setAnchor(undefined);
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  const result = h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  assert.equal(result, undefined);
  assert.deepEqual(h.sinkCalls, []);
  assert.deepEqual(h.lastTrace("reanchor"), { event: "reanchor", delivered: false, reason: "missing-anchor" });
});

test("评估与投递之间锚点版本变化被 prepare 拒绝", () => {
  const h = harness();
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  h.setAnchor({ ref: { provider: "rules", id: "main" }, version: "2", content: "锚点内容二" });
  const result = h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  assert.equal(result, undefined);
  assert.deepEqual(h.sinkCalls, []);
  assert.equal(h.cores[0]!.getState().real.attempts, 0);
  assert.deepEqual(h.lastTrace("reanchor"), { event: "reanchor", delivered: false, reason: "anchor-changed" });
});

test("settle 边界 wake 追加续跑消息，wake 触发的下一轮被自激防护压制", () => {
  const h = harness();
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  h.setAnchor({ ref: { provider: "rules", id: "main" }, version: "2", content: "锚点内容二" });
  const wake = h.fire("agent_before_settle", settleBoundary()) as {
    entries: Array<Record<string, unknown>>; continue: boolean;
  };
  assert.equal(wake.continue, true);
  assert.equal(wake.entries[0]!.type, "custom_message");
  assert.equal(wake.entries[0]!.customType, "pi-agent-recall.wake.v1");
  assert.equal(wake.entries[0]!.content, "锚点内容二");
  assert.deepEqual(h.sinkCalls, ["reanchor", "wake"]);
  assert.equal(h.cores[0]!.getState().real.wakeAttempts, 1);

  h.fire("before_agent_start", { messageType: "custom", message: { customType: "pi-agent-recall.wake.v1" } });
  const reanchor = h.fire("context", { messages: [{ role: "custom", customType: "pi-agent-recall.wake.v1" }] });
  assert.equal(reanchor, undefined);
  assert.deepEqual(h.lastTrace("reanchor"), { event: "reanchor", delivered: false, reason: "self-trigger" });

  const again = h.fire("agent_before_settle", settleBoundary({
    context: { pendingMessages: [], canContinue: true, contextMessages: [
      { role: "custom", customType: "pi-agent-recall.wake.v1", content: "x", display: false },
    ] },
  }));
  assert.equal(again, undefined);
  assert.deepEqual(h.lastTrace("wake"), { event: "wake", delivered: false, reason: "self-trigger" });
  assert.equal(h.cores[0]!.getState().real.wakeAttempts, 1);
});

test("wake 只在真正停下的边界出现", () => {
  const h = harness();
  h.fire("session_start");
  const pending = h.fire("agent_before_settle", settleBoundary({
    context: { pendingMessages: [{ role: "user" }], canContinue: true, contextMessages: [] },
  }));
  assert.equal(pending, undefined);
  assert.deepEqual(h.lastTrace("wake"), { event: "wake", delivered: false, reason: "no-opportunity" });
  const aborted = h.fire("agent_before_settle", settleBoundary({ outcome: "aborted" }));
  assert.equal(aborted, undefined);
  assert.deepEqual(h.sinkCalls, []);
});

test("sink 显式失败记 failed 且不退款", () => {
  const h = harness(emitConfig(), { accept: () => { throw new Error("sink down"); } });
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  const result = h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  assert.equal(result, undefined);
  assert.deepEqual(h.lastTrace("reanchor"), { event: "reanchor", delivered: false, reason: "sink-failed" });
  assert.equal(h.cores[0]!.getState().real.attempts, 1);
});

test("同一锚点版本在去重窗口内不重复投递", () => {
  const h = harness();
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  h.fire("before_agent_start", { messageType: "user" });
  const result = h.fire("context", { messages: [{ role: "user", content: "第二条消息" }] });
  assert.equal(result, undefined);
  assert.deepEqual(h.lastTrace("reanchor"), { event: "reanchor", delivered: false, reason: "duplicate" });
  assert.deepEqual(h.sinkCalls, ["reanchor"]);
});

test("未知上下文默认 off，完全不投递", () => {
  const h = harness({ context });
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  const result = h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  assert.equal(result, undefined);
  assert.deepEqual(h.lastTrace("reanchor"), { event: "reanchor", delivered: false, reason: "off" });
  assert.deepEqual(h.sinkCalls, []);
});

test("activity 推进 epoch、reload 推进代次，同一事件对象去重", () => {
  const h = harness();
  h.fire("session_start");
  const raw = { text: "用户输入" };
  h.fire("input", raw);
  h.fire("input", raw);
  h.fire("input", { text: "另一次输入" });
  const activities = h.traces.filter(entry => entry.event === "activity");
  assert.equal(activities.length, 2);
  assert.equal(activities[0]!.fence?.epoch, 1);
  assert.equal(activities[1]!.fence?.epoch, 2);
  assert.equal(activities[1]!.fence?.generation, 0);
  h.fire("session_before_compact", {});
  const reload = h.lastTrace("reload");
  assert.equal(reload?.fence?.generation, 1);
  assert.equal(reload?.fence?.epoch, 0);
});

test("session_shutdown 后回调显式关闭，宿主侧异常不传播", () => {
  const h = harness();
  h.fire("session_start");
  h.fire("session_shutdown");
  const result = h.fire("context", { messages: [] });
  assert.equal(result, undefined);
  assert.deepEqual(h.lastTrace("context"), { event: "context", reason: "closed" });
  assert.doesNotThrow(() => h.fire("session_before_compact", {}));
});

test("core 内部抛错时 reload 回调 fail-closed 而不是炸宿主", () => {
  const traces: PiRecallTrace[] = [];
  const handlers = new Map<string, (event: unknown) => unknown>();
  const pi: PiExtensionApi = { on: (event, handler) => void handlers.set(event, handler) };
  const broken = {
    getState: () => ({ fence: { scope: "s", owner: "o", incarnation: "i", revision: 1, generation: 1, epoch: 1 } }),
    transition: () => { throw new Error("boom"); },
    close: () => {},
  } as unknown as PolicyCore;
  createPiRecallExtension({
    scope: "s", owner: "o", config: { context },
    anchors: { current: () => undefined },
    now: () => 0, trace: entry => traces.push(entry),
    createCore: () => broken,
  })(pi);
  handlers.get("session_start")!(undefined);
  assert.doesNotThrow(() => handlers.get("session_before_compact")!({}));
  assert.deepEqual(traces.at(-1), { event: "session_before_compact", reason: "error" });
});
