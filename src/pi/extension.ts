/** Pi 事件组合根；唯一 session emit owner 在这里持有 core，不进入 core。 */
import { randomUUID } from "node:crypto";
import type { AnchorMetadata, AttentionConfig, PolicyCore, PolicyFence } from "../core/index.js";
import { createPolicyCore, resolveProfile } from "../core/index.js";
import type {
  PiAnchorProvider, PiCommandDefinition, PiDeliverySink, PiMessage, PiSettleBoundary, PiToolDefinition,
} from "./host-types.js";
import { readAnchor } from "./anchor.js";
import { registerRecallSurface } from "./surface.js";
import { createRecallRuntime, type RecallRuntime } from "./recall-runtime.js";

/** 无正文适配器诊断；用于测试证据和 fail-closed 观察。 */
export interface PiRecallTrace {
  event: string;
  delivered?: boolean;
  reason?: string;
  fence?: PolicyFence;
  anchor?: AnchorMetadata;
}

/** 本 adapter 使用的最小 ExtensionAPI 结构；注册面可选以增强结构性兼容。 */
export interface PiExtensionApi {
  on(event: string, handler: (event: unknown) => unknown): void;
  registerTool?(tool: PiToolDefinition): void;
  registerCommand?(name: string, command: PiCommandDefinition): void;
}

/** 测试先行 extension 的同步依赖；不读取全局配置或宿主凭据。 */
export interface PiRecallExtensionOptions {
  scope: string;
  owner: string;
  config: AttentionConfig;
  anchors: PiAnchorProvider;
  now(): number;
  trace(entry: PiRecallTrace): void;
  createIncarnation?(): string;
  createCore?(incarnation: string, config: AttentionConfig): PolicyCore;
  sink?: PiDeliverySink;
  /** refresh 信号的 AnchorProvider 通知接缝；缺失时模型调用 refresh 显式 unsupported。 */
  requestAnchorRefresh?(): void;
}

interface BeforeStart { messageType: "user" | "custom"; message?: { customType?: string } }
interface Context { messages: PiMessage[] }

/** 创建仅由调用方显式加载的 Pi extension factory。 */
export function createPiRecallExtension(options: PiRecallExtensionOptions): (pi: PiExtensionApi) => void {
  return (pi) => {
    let core: PolicyCore | undefined;
    let runtime: RecallRuntime | undefined;
    const seen = new WeakSet<object>();
    // config-hint 感知状态；session_start 时重置。
    const hint = { last: undefined as string | undefined, consecutive: 0, sent: new Map<string, number>(), total: 0 };
    const trace = (entry: PiRecallTrace) => options.trace(entry);
    const close = () => {
      runtime?.close();
      runtime = undefined;
      core = undefined;
      trace({ event: "close" });
    };
    const current = (event: string): RecallRuntime | undefined => {
      if (runtime) return runtime;
      trace({ event, reason: "closed" });
      return undefined;
    };
    const guard = (event: string, action: () => unknown): unknown => {
      try { return action(); }
      catch { trace({ event, reason: "error" }); return undefined; }
    };

    pi.on("session_start", () => guard("session_start", () => {
      hint.last = undefined; hint.consecutive = 0; hint.sent.clear(); hint.total = 0;
      runtime?.close();
      const incarnation = options.createIncarnation?.() ?? randomUUID();
      core = options.createCore?.(incarnation, options.config) ?? createPolicyCore({ scope: options.scope, owner: options.owner,
        incarnation, config: options.config });
      runtime = createRecallRuntime({ core, anchors: options.anchors, ...(options.sink ? { sink: options.sink } : {}) });
      trace({ event: "runtime", fence: core.getState().fence });
    }));
    pi.on("before_agent_start", raw => guard("before_agent_start", () => {
      const event = raw as BeforeStart;
      current("before_agent_start")?.beginRun(event.messageType === "custom"
        && event.message?.customType === "pi-agent-recall.wake.v1" ? "attention" : "external", options.now());
    }));
    pi.on("context", raw => guard("context", () => {
      const active = current("context");
      if (!active) return undefined;
      const result = active.reanchor((raw as Context).messages, options.now());
      trace({ event: "reanchor", delivered: result.delivered,
        ...(result.reason ? { reason: result.reason } : {}) });
      if (result.delivered) {
        hint.last = undefined;
        hint.consecutive = 0;
        return { messages: result.messages };
      }
      const hinted = configHint(result.reason, (raw as Context).messages, options.now());
      return hinted ? { messages: hinted } : undefined;
    }));
    pi.on("agent_before_settle", raw => guard("agent_before_settle", () => {
      const active = current("agent_before_settle");
      if (!active) return undefined;
      const result = active.wake(raw as PiSettleBoundary, options.now());
      trace({ event: "wake", delivered: result.delivered,
        ...(result.reason ? { reason: result.reason } : {}) });
      return result.delivered ? result.result : undefined;
    }));
    pi.on("input", raw => activity(raw, "input"));
    pi.on("tool_execution_end", raw => activity(raw, "tool_execution_end"));
    pi.on("session_before_compact", raw => reload(raw, "session_before_compact"));
    pi.on("session_before_tree", raw => reload(raw, "session_before_tree"));
    pi.on("session_before_switch", () => close());
    pi.on("session_shutdown", () => close());

    registerRecallSurface(pi, {
      core: () => core,
      anchors: options.anchors,
      now: () => options.now(),
      trace,
      ...(options.requestAnchorRefresh ? { requestAnchorRefresh: options.requestAnchorRefresh } : {}),
      // 将白名单 patch 重建为完整 AttentionConfig：resolveProfile 平铺当前生效值，覆盖后整体重校验。
      applyConfigure: next => {
        if (!core) throw new Error("closed");
        const resolved = resolveProfile(options.config);
        core.applyConfig({ context: options.config.context, profiles: [{ id: resolved.id, context: resolved.context,
          settings: { ...resolved.settings, ...next } }] });
      },
    });

    /** 感知配置相关状态并注入 display:false 的召回手册指引；同 reason 每 epoch 至多一次，全局至多 3 次。 */
    function configHint(reason: string | undefined, messages: PiMessage[], now: number): PiMessage[] | undefined {
      if (!reason || !core) return undefined;
      hint.consecutive = reason === hint.last ? hint.consecutive + 1 : 1;
      hint.last = reason;
      const trigger = reason === "missing-anchor" ? hint.consecutive >= 1 : hint.consecutive >= 2;
      if (!trigger) return undefined;
      const state = core.getState();
      if (hint.sent.get(reason) === state.fence.epoch || hint.total >= 3) return undefined;
      hint.sent.set(reason, state.fence.epoch);
      hint.total += 1;
      const anchor = readAnchor(options.anchors)?.metadata;
      const summary = "recall config-hint: mode=" + state.profile.settings.mode + " profile=" + state.profile.id
        + " suppression=" + reason + "x" + hint.consecutive
        + " anchor=" + (anchor ? `${anchor.ref.provider}/${anchor.ref.id}@${anchor.version}` : "missing")
        + "。加载 skill recall-config 获取配置指引（configure 白名单：shadow/off 与数值参数；emit 由人类决定）。";
      trace({ event: "config-hint", reason, fence: state.fence });
      return [...messages, { role: "custom", customType: "pi-agent-recall.config-hint.v1",
        content: summary, display: false, timestamp: now }];
    }

    function activity(raw: unknown, event: string): void {
      guard(event, () => {
        if (raw && typeof raw === "object") {
          if (seen.has(raw)) return;
          seen.add(raw);
        }
        if (!core) { trace({ event, reason: "closed" }); return; }
        const result = core.transition({ kind: "activity", fence: core.getState().fence,
          provenance: "external", now: options.now() });
        trace({ event: "activity", ...(result.status === "applied" ? { fence: result.fence } : { reason: result.reason }) });
      });
    }
    function reload(raw: unknown, event: string): void {
      guard(event, () => {
        if (!core) { trace({ event, reason: "closed" }); return; }
        const result = core.transition({ kind: "reload", fence: core.getState().fence,
          provenance: "external", now: options.now() });
        trace({ event: "reload", ...(result.status === "applied" ? { fence: result.fence } : { reason: result.reason }) });
      });
    }
  };
}
