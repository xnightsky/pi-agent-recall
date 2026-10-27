/** 会话面单元测试：恰好一个 recall 信号工具与一个 /recall 只读命令；fake api 捕获注册，零 token。 */
import assert from "node:assert/strict";
import test from "node:test";
import type { AttentionConfig, PolicyCore } from "../../src/core/index.js";
import { createPolicyCore } from "../../src/core/index.js";
import { createPiRecallExtension, type PiRecallTrace } from "../../src/pi/extension.js";
import type { PiAnchorSnapshot } from "../../src/pi/host-types.js";

/** 与宿主版本对齐的虚构归因上下文；不代表任何已标定模型。 */
const context = {
  host: "pi", hostVersion: "1.4.0", provider: "fixture", model: "fake",
  modelRevision: "1", taskFamily: "unit", roleTopology: "single",
  policyVersion: "p1", reminderTextVersion: "t1",
};

function emitConfig(): AttentionConfig {
  return { context, profiles: [{ id: "emit-all", context, settings: {
    mode: "emit", allowReanchor: true, allowWake: true, minEvidence: 1,
    cooldownMs: 0, wakeCooldownMs: 0, dedupeMs: 60_000,
    maxAttemptsPerEpoch: 4, maxWakePerEpoch: 2, reservationTtlMs: 60_000,
  } }] };
}

interface CapturedTool {
  name: string;
  execute(id: string, params: unknown, signal?: unknown, onUpdate?: unknown, ctx?: unknown): Promise<ToolResult>;
}
interface ToolResult { content: Array<{ type: string; text: string }>; isError?: boolean }
interface CapturedCommand { handler(args: string, ctx: unknown): Promise<void> }

interface SurfaceHarness {
  tools: Map<string, CapturedTool>;
  commands: Map<string, CapturedCommand>;
  notifications: Array<{ message: string; type?: string | undefined }>;
  traces: PiRecallTrace[];
  cores: PolicyCore[];
  refreshCalls: number;
  fire(name: string, event?: unknown): unknown;
  runCommand(args: string): Promise<void>;
  callTool(params: unknown): Promise<ToolResult>;
}

/** 组装 extension 与捕获注册的 fake api；时间恒为 0，全部同步。 */
function harness(options?: { anchor?: PiAnchorSnapshot | undefined; withRefreshSeam?: boolean }): SurfaceHarness {
  const snapshot: PiAnchorSnapshot | undefined = options && "anchor" in options ? options.anchor : {
    ref: { provider: "rules", id: "main" }, version: "1", content: "锚点内容一",
  };
  const traces: PiRecallTrace[] = [];
  const cores: PolicyCore[] = [];
  const tools = new Map<string, CapturedTool>();
  const commands = new Map<string, CapturedCommand>();
  const notifications: Array<{ message: string; type?: string | undefined }> = [];
  const handlers = new Map<string, (event: unknown) => unknown>();
  const state: SurfaceHarness = {
    tools, commands, notifications, traces, cores, refreshCalls: 0,
    fire: (name, event) => handlers.get(name)!(event),
    runCommand: args => commands.get("recall")!.handler(args, {
      ui: { notify: (message: string, type?: string | undefined) => notifications.push({ message, type }) },
    }),
    callTool: params => tools.get("recall")!.execute("call-1", params, undefined, undefined, undefined),
  };
  const pi = {
    on: (event: string, handler: (event: unknown) => unknown) => void handlers.set(event, handler),
    registerTool: (tool: CapturedTool) => void tools.set(tool.name, tool),
    registerCommand: (name: string, command: CapturedCommand) => void commands.set(name, command),
  };
  createPiRecallExtension({
    scope: "unit", owner: "unit-owner", config: emitConfig(),
    anchors: { current: () => snapshot ? structuredClone(snapshot) : undefined },
    now: () => 0,
    trace: entry => traces.push(entry),
    createCore: (incarnation, cfg) => {
      const core = createPolicyCore({ scope: "unit", owner: "unit-owner", incarnation, config: cfg });
      cores.push(core);
      return core;
    },
    ...(options?.withRefreshSeam ? { requestAnchorRefresh: () => { state.refreshCalls += 1; } } : {}),
  // 结构性 fake：真实 ExtensionAPI 的超集子集，编译期不依赖宿主包。
  })(pi as never);
  return state;
}

function started(h: SurfaceHarness): SurfaceHarness {
  h.fire("session_start");
  return h;
}

test("恰好注册一个 recall 工具与一个 /recall 命令", () => {
  const h = harness();
  assert.equal(h.tools.size, 1);
  assert.ok(h.tools.has("recall"), "tool must be named recall");
  assert.equal(h.commands.size, 1);
  assert.ok(h.commands.has("recall"), "command must be named recall");
});

test("acknowledge 落带 fence 与版本归因的弱证据 trace，且不计尝试", async () => {
  const h = started(harness());
  const result = await h.callTool({ action: "acknowledge" });
  assert.equal(result.isError, undefined);
  assert.ok(result.content[0]!.text.includes("rules/main@1"), "回执应携带当前锚点归因");
  const entry = h.traces.find(row => row.event === "acknowledge");
  assert.ok(entry, "acknowledge 必须落 trace");
  // anchor 字段由实现补入 PiRecallTrace；RED 期用结构化读取避免类型先行。
  assert.equal((entry as { anchor?: { version?: string } }).anchor?.version, "1");
  assert.ok(entry!.fence, "trace 必须带 fence 归因");
  assert.equal(h.cores[0]!.getState().real.attempts, 0);
});

test("锚点缺失时 acknowledge 显式失败", async () => {
  const h = started(harness({ anchor: undefined }));
  const result = await h.callTool({ action: "acknowledge" });
  assert.equal(result.isError, true);
  assert.ok(result.content[0]!.text.includes("missing-anchor"));
  assert.equal(h.traces.some(row => row.event === "acknowledge"), false);
});

test("refresh 经显式接缝通知 AnchorProvider 并留痕；无接缝显式失败", async () => {
  const h = started(harness({ withRefreshSeam: true }));
  const result = await h.callTool({ action: "refresh" });
  assert.equal(result.isError, undefined);
  assert.equal(h.refreshCalls, 1);
  assert.ok(h.traces.some(row => row.event === "refresh"
    && (row as { anchor?: { version?: string } }).anchor?.version === "1"));

  const bare = started(harness());
  const rejected = await bare.callTool({ action: "refresh" });
  assert.equal(rejected.isError, true);
  assert.ok(rejected.content[0]!.text.includes("unsupported"));
});

test("未知 action 双重拒绝：isError 返回，不抛错，不留痕", async () => {
  const h = started(harness());
  const result = await h.callTool({ action: "erase" });
  assert.equal(result.isError, true);
  assert.ok(result.content[0]!.text.includes("unknown-action"));
  assert.equal(h.traces.filter(row => row.event !== "runtime").length, 0);
});

test("会话未启动时工具显式 closed 而不抛错", async () => {
  const h = harness();
  const result = await h.callTool({ action: "acknowledge" });
  assert.equal(result.isError, true);
  assert.ok(result.content[0]!.text.includes("closed"));
});

test("/recall 机械渲染当前策略快照，未启动时显式 inactive", async () => {
  const h = harness();
  await h.runCommand("");
  assert.ok(h.notifications[0]!.message.includes("inactive"), "未启动必须显式 inactive");

  h.fire("session_start");
  h.fire("before_agent_start", { messageType: "user" });
  h.fire("context", { messages: [{ role: "user", content: "原始消息" }] });
  await h.runCommand("");
  const view = h.notifications[1]!.message;
  assert.ok(view.includes("mode: emit"), view);
  assert.ok(view.includes("emit-all"), view);
  assert.ok(view.includes("rules/main"), view);
  assert.ok(view.includes("attempts 1"), view);
  assert.ok(!view.includes("锚点内容一"), "视图不得包含锚点正文");
});

test("configure 白名单参数生效并落带 fence 的审计 trace", async () => {
  const h = started(harness());
  const result = await h.callTool({ action: "configure", mode: "shadow", cooldownMs: 5 });
  assert.equal(result.isError, undefined);
  const state = h.cores[0]!.getState();
  assert.equal(state.profile.settings.mode, "shadow", "mode 应被 configure 改为 shadow");
  assert.equal(state.profile.settings.cooldownMs, 5);
  const entry = h.traces.find(row => row.event === "configure");
  assert.ok(entry, "configure 必须落审计 trace");
  assert.equal(entry!.delivered, true);
  assert.ok(entry!.fence, "trace 必须带 fence 归因");
});

test("configure 的 schema 与 execute 双重拒绝 emit", async () => {
  const h = started(harness());
  const tool = h.tools.get("recall") as unknown as { parameters: unknown };
  assert.equal(JSON.stringify(tool.parameters).includes('"emit"'), false, "schema 结构性无 emit");
  const result = await h.callTool({ action: "configure", mode: "emit" });
  assert.equal(result.isError, true, "execute 必须二次拒绝 emit");
  assert.equal(h.cores[0]!.getState().profile.settings.mode, "emit", "拒绝后状态不变");
});

test("configure 空配置、未知键与错误类型整体拒绝", async () => {
  const h = started(harness());
  assert.equal((await h.callTool({ action: "configure" })).isError, true, "空配置拒绝");
  assert.equal((await h.callTool({ action: "configure", bogus: 1 })).isError, true, "未知键拒绝");
  assert.equal((await h.callTool({ action: "configure", cooldownMs: "x" })).isError, true, "类型不符拒绝");
  assert.equal((await h.callTool({ action: "configure", dedupeMs: Number.NaN })).isError, true, "非有限数拒绝");
  assert.equal(h.cores[0]!.getState().profile.settings.mode, "emit", "全部拒绝后状态不变");
});

test("会话未启动时 configure 显式 closed", async () => {
  const h = harness();
  const result = await h.callTool({ action: "configure", mode: "off" });
  assert.equal(result.isError, true);
  assert.ok(result.content[0]!.text.includes("closed"));
});
