/** adapter 增量契约：只补 pi-extension/pi-recall-runtime 未覆盖的缝隙；零 token，不拉起真实 Pi。 */
import assert from "node:assert/strict";
import test from "node:test";
import { createPolicyCore, type AttentionConfig, type PolicyCore } from "../../src/core/index.js";
import {
  createPiRecallExtension, type PiExtensionApi, type PiRecallTrace,
} from "../../src/pi/extension.js";
import type { PiAnchorSnapshot } from "../../src/pi/host-types.js";

/** 与宿主版本对齐的虚构归因上下文；不代表任何已标定模型。 */
const context = {
  host: "pi", hostVersion: "1.4.0", provider: "fixture", model: "fake",
  modelRevision: "1", taskFamily: "unit", roleTopology: "single",
  policyVersion: "p1", reminderTextVersion: "t1",
};

interface Harness {
  fire(name: string, event?: unknown): unknown;
  traces: PiRecallTrace[];
  lastTrace(event: string): PiRecallTrace | undefined;
}

/** 组装显式加载的 extension 与 fake ExtensionAPI；时间恒为 0，事件全部同步。 */
function harness(config?: AttentionConfig): Harness {
  const snapshot: PiAnchorSnapshot = {
    ref: { provider: "rules", id: "main" }, version: "1", content: "锚点内容一",
  };
  const traces: PiRecallTrace[] = [];
  const handlers = new Map<string, (event: unknown) => unknown>();
  const pi: PiExtensionApi = { on: (event, handler) => void handlers.set(event, handler) };
  createPiRecallExtension({
    scope: "unit", owner: "unit-owner",
    config: config ?? { context, profiles: [{ id: "emit-all", context, settings: {
      mode: "emit", allowReanchor: true, allowWake: true, minEvidence: 1,
      cooldownMs: 0, wakeCooldownMs: 0, dedupeMs: 60_000,
      maxAttemptsPerEpoch: 4, maxWakePerEpoch: 2, reservationTtlMs: 60_000,
    } }] },
    anchors: { current: () => snapshot ? structuredClone(snapshot) : undefined },
    now: () => 0,
    trace: entry => traces.push(entry),
  })(pi);
  return {
    fire: (name, event) => handlers.get(name)!(event),
    traces,
    lastTrace: event => [...traces].reverse().find(entry => entry.event === event),
  };
}

test("同一锚点版本在去重窗口内不重复投递", () => {
  const h = harness();
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  h.fire("before_agent_start", { messageType: "user" });
  const result = h.fire("context", { messages: [{ role: "user", content: "第二条消息" }] });
  assert.equal(result, undefined);
  assert.deepEqual(h.lastTrace("reanchor"), { event: "reanchor", delivered: false, reason: "duplicate" });
});

test("未知上下文默认 off，完全不投递", () => {
  const h = harness({ context });
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  const result = h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  assert.equal(result, undefined);
  assert.deepEqual(h.lastTrace("reanchor"), { event: "reanchor", delivered: false, reason: "off" });
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

/** 组装一个 sink 可在 accept 内嵌套推进 core 时钟的 harness。 */
function sinkTransitionHarness(): { traces: PiRecallTrace[]; fire(name: string, event?: unknown): unknown } {
  const traces: PiRecallTrace[] = [];
  const handlers = new Map<string, (event: unknown) => unknown>();
  const pi: PiExtensionApi = { on: (event, handler) => void handlers.set(event, handler) };
  let inner: PolicyCore | undefined;
  createPiRecallExtension({
    scope: "s", owner: "o", config: { context, profiles: [{ id: "emit-all", context, settings: {
      mode: "emit", allowReanchor: true, allowWake: false, minEvidence: 1,
      cooldownMs: 0, dedupeMs: 60_000, maxAttemptsPerEpoch: 4, reservationTtlMs: 60_000,
    } }] },
    anchors: { current: () => ({ ref: { provider: "rules", id: "main" }, version: "1", content: "x" }) },
    now: () => 0, trace: entry => traces.push(entry),
    createCore: (incarnation, cfg) => {
      inner = createPolicyCore({ scope: "s", owner: "o", incarnation, config: cfg });
      return inner;
    },
    // sink 内嵌套一次 activity 转换并把实例时钟推进到 1。
    sink: { accept: () => { inner!.transition({ kind: "activity", fence: inner!.getState().fence,
      provenance: "external", now: 1 }); } },
  })(pi);
  return { traces, fire: (name, event) => handlers.get(name)!(event) };
}

test("sink 内嵌套推进时钟时 commit 被钳制到实例最新时刻", () => {
  const h = sinkTransitionHarness();
  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  const reanchor = h.traces.find(row => row.event === "reanchor");
  assert.equal(reanchor?.delivered, true, "commit 不得因时钟倒退失败");
  assert.equal(h.traces.some(row => row.reason === "error"), false);
});

/** 组装锚点可变的 harness，驱动 config-hint 感知链路。 */
function hintHarness(anchor: () => PiAnchorSnapshot | undefined): Harness {
  const traces: PiRecallTrace[] = [];
  const handlers = new Map<string, (event: unknown) => unknown>();
  const pi: PiExtensionApi = { on: (event, handler) => void handlers.set(event, handler) };
  createPiRecallExtension({
    scope: "unit", owner: "unit-owner",
    config: { context, profiles: [{ id: "emit-all", context, settings: {
      mode: "emit", allowReanchor: true, allowWake: false, minEvidence: 1,
      cooldownMs: 0, dedupeMs: 60_000, maxAttemptsPerEpoch: 8, reservationTtlMs: 60_000,
    } }] },
    anchors: { current: anchor },
    now: () => 0,
    trace: entry => traces.push(entry),
  })(pi);
  return {
    fire: (name, event) => handlers.get(name)!(event),
    traces,
    lastTrace: event => [...traces].reverse().find(entry => entry.event === event),
  };
}

/** 一个完整用户轮：before_agent_start + context，返回 context 的注入结果。 */
function turn(h: Harness): { messages: Array<{ customType?: string; display?: boolean }> } | undefined {
  h.fire("before_agent_start", { messageType: "user" });
  return h.fire("context", { messages: [{ role: "user", content: "m" }] }) as
    { messages: Array<{ customType?: string; display?: boolean }> } | undefined;
}

const anchorV1: PiAnchorSnapshot = { ref: { provider: "rules", id: "main" }, version: "1", content: "x" };

test("同一抑制 reason 连续两次后注入 config-hint 并落 trace", () => {
  const h = hintHarness(() => structuredClone(anchorV1));
  h.fire("session_start");
  turn(h); // 首次投递成功
  assert.equal(turn(h), undefined, "首次抑制不注入 hint");
  const result = turn(h); // duplicate ×2
  const hint = result?.messages.find(m => m.customType === "pi-agent-recall.config-hint.v1");
  assert.ok(hint, "连续抑制两次必须注入 config-hint");
  assert.equal(hint!.display, false, "hint 不进 TUI 渲染");
  assert.ok(h.traces.some(row => row.event === "config-hint" && row.reason === "duplicate"), "hint 必须落 trace");
});

test("config-hint 频控：同 epoch 同 reason 至多一次", () => {
  const h = hintHarness(() => structuredClone(anchorV1));
  h.fire("session_start");
  turn(h);
  turn(h);
  turn(h); // 触发首次 hint
  turn(h);
  turn(h);
  assert.equal(h.traces.filter(row => row.event === "config-hint").length, 1, "同 epoch 同 reason 不重复");
});

test("missing-anchor 首次即触发 config-hint", () => {
  const h = hintHarness(() => undefined);
  h.fire("session_start");
  const result = turn(h);
  assert.ok(result?.messages.some(m => m.customType === "pi-agent-recall.config-hint.v1"));
  assert.ok(h.traces.some(row => row.event === "config-hint" && row.reason === "missing-anchor"));
});

test("成功投递重置连续抑制计数", () => {
  let version = 1;
  const h = hintHarness(() => ({ ref: { provider: "rules", id: "main" }, version: String(version), content: "x" }));
  h.fire("session_start");
  turn(h);                    // delivered v1
  assert.equal(turn(h), undefined); // duplicate ×1
  version = 2;
  turn(h);                    // delivered v2，计数重置
  assert.equal(turn(h), undefined, "重置后的首次抑制仍不注入");
  const result = turn(h);     // duplicate ×2 → hint
  assert.ok(result?.messages.some(m => m.customType === "pi-agent-recall.config-hint.v1"));
  assert.equal(h.traces.filter(row => row.event === "config-hint").length, 1);
});
