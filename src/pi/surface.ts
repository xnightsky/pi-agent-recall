/** 会话面：恰好一个 recall 信号工具与一个 /recall 只读命令；无正文、零宿主类型依赖。 */
import type { AnchorMetadata, PolicyCore, PolicySettings, PolicyState } from "../core/index.js";
import { member, object } from "../core/validation.js";
import { readAnchor } from "./anchor.js";
import type { PiAnchorProvider, PiToolResult } from "./host-types.js";
import type { PiExtensionApi, PiRecallTrace } from "./extension.js";

/** 会话面运行期依赖；core 可能尚未启动，全部显式判空。 */
export interface RecallSurfaceDeps {
  core(): PolicyCore | undefined;
  anchors: PiAnchorProvider;
  now(): number;
  trace(entry: PiRecallTrace): void;
  /** refresh 动作的唯一 AnchorProvider 通知接缝；缺失则 refresh 显式 unsupported。 */
  requestAnchorRefresh?(): void;
  /** configure 动作的唯一应用接缝；缺失则 configure 显式 unsupported。 */
  applyConfigure?(next: Partial<PolicySettings>): void;
}

const ACTIONS = ["acknowledge", "refresh", "configure"] as const;

/** configure 白名单键；emit 结构性缺席，人专属。 */
const CONFIGURABLE = ["mode", "allowReanchor", "allowWake", "cooldownMs", "dedupeMs", "maxAttemptsPerEpoch"] as const;

/** TypeBox 兼容 JSON Schema 字面量；保持包零运行时依赖。 */
const RECALL_PARAMETERS = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["action"],
      properties: { action: { type: "string", enum: ["acknowledge"],
        description: "确认收到当前锚点版本（弱证据，仅落带 fence 归因的 trace）" } } },
    { type: "object", additionalProperties: false, required: ["action"],
      properties: { action: { type: "string", enum: ["refresh"],
        description: "声明锚点过时，请求 AnchorProvider 升版本" } } },
    { type: "object", additionalProperties: false, required: ["action"],
      properties: {
        action: { type: "string", enum: ["configure"],
          description: "有界调整召回参数（收到 config-hint 后按 skill recall-config 手册使用）" },
        mode: { type: "string", enum: ["shadow", "off"],
          description: "emit 不在模型面内，由人类经宿主配置决定" },
        allowReanchor: { type: "boolean" }, allowWake: { type: "boolean" },
        cooldownMs: { type: "number" }, dedupeMs: { type: "number" }, maxAttemptsPerEpoch: { type: "number" },
      } },
  ],
} as const;

function ok(text: string): PiToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(text: string): PiToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function anchorLabel(anchor: AnchorMetadata): string {
  return `${anchor.ref.provider}/${anchor.ref.id}@${anchor.version}`;
}

/** 执行 configure：白名单键逐一校验，未知键/空配置/emit 整体拒绝，失败显式 isError。 */
function executeConfigure(raw: Record<string, unknown>, core: PolicyCore, deps: RecallSurfaceDeps): PiToolResult {
  const keys = Object.keys(raw).filter(key => key !== "action");
  if (keys.length === 0) return fail("empty-configure: no configurable key provided");
  const next: Partial<PolicySettings> = {};
  for (const key of keys) {
    const value = raw[key];
    if (!CONFIGURABLE.includes(key as (typeof CONFIGURABLE)[number])) {
      return fail(`unknown-key: ${key} is not configurable`);
    }
    if (key === "mode") {
      if (value !== "shadow" && value !== "off") return fail("rejected: mode only allows shadow/off; emit 由人类决定");
      next.mode = value;
    } else if (key === "allowReanchor" || key === "allowWake") {
      if (typeof value !== "boolean") return fail(`rejected: ${key} must be boolean`);
      next[key] = value;
    } else {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail(`rejected: ${key} must be a finite number`);
      next[key as "cooldownMs" | "dedupeMs" | "maxAttemptsPerEpoch"] = value;
    }
  }
  if (!deps.applyConfigure) return fail("unsupported: no configure seam");
  try {
    deps.applyConfigure(next);
  } catch {
    deps.trace({ event: "configure", delivered: false, reason: "rejected", fence: core.getState().fence });
    return fail("rejected: core refused the configure patch");
  }
  deps.trace({ event: "configure", delivered: true, fence: core.getState().fence });
  return ok(`configure applied: ${keys.sort().join(", ")}`);
}

/** 执行一次召回信号；acknowledge/refresh/configure 三动作，emit 在 schema 与 execute 双重缺席。 */
export async function executeRecallSignal(params: unknown, deps: RecallSurfaceDeps): Promise<PiToolResult> {
  const core = deps.core();
  if (!core) return fail("closed: recall core is not running");
  let raw: Record<string, unknown>;
  try {
    raw = object(params, "params", ["action", ...CONFIGURABLE]);
  } catch {
    return fail("unknown-key: params must be a plain object with known keys");
  }
  let action: string;
  try {
    member(raw.action, ACTIONS, "params.action");
    action = raw.action as string;
  } catch {
    return fail(`unknown-action: expected one of ${ACTIONS.join("/")}`);
  }
  if (action === "configure") return executeConfigure(raw, core, deps);
  const current = readAnchor(deps.anchors);
  if (!current) return fail("missing-anchor: no current anchor snapshot");
  const fence = core.getState().fence;
  if (action === "acknowledge") {
    deps.trace({ event: "acknowledge", fence, anchor: current.metadata });
    return ok(`acknowledged ${anchorLabel(current.metadata)}`);
  }
  if (!deps.requestAnchorRefresh) return fail("unsupported: no AnchorProvider refresh seam");
  deps.requestAnchorRefresh();
  deps.trace({ event: "refresh", fence, anchor: current.metadata });
  return ok(`refresh requested for ${anchorLabel(current.metadata)}`);
}

function lastLog(state: PolicyState, kind: "silent" | "delivery"): string | undefined {
  for (let index = state.logs.length - 1; index >= 0; index--) {
    const log = state.logs[index]!;
    if (kind === "silent" && log.action === "silent") return log.reason;
    if (kind === "delivery" && log.delivery) return `${log.action} ${log.delivery}`;
  }
  return undefined;
}

/** 机械渲染当前策略快照；纯函数，不渲染正文，未启动显式 inactive。 */
export function renderRecallView(state: PolicyState | undefined, anchor?: AnchorMetadata): string {
  if (!state) return "recall: inactive（无存活会话内核）";
  const lines = [
    `mode: ${state.profile.settings.mode} · profile: ${state.profile.id} (${state.profile.source})`,
    `fence: rev ${state.fence.revision} · gen ${state.fence.generation} · epoch ${state.fence.epoch} · owner: ${state.fence.owner}`,
    `ledger: attempts ${state.real.attempts} (wake ${state.real.wakeAttempts}) · shadow ${state.shadow.attempts}`,
  ];
  const suppression = lastLog(state, "silent");
  if (suppression) lines.push(`last suppression: ${suppression}`);
  const delivery = lastLog(state, "delivery");
  if (delivery) lines.push(`last delivery: ${delivery}`);
  lines.push(anchor
    ? `anchor: ${anchorLabel(anchor)} · ${anchor.sizeBytes} B${anchor.expiresAt !== undefined ? ` · expires ${anchor.expiresAt}` : ""}`
    : "anchor: 缺失");
  return lines.join("\n");
}

/** 注册恰好一个 recall 工具与一个 /recall 命令；宿主缺失注册面时静默跳过。 */
export function registerRecallSurface(api: Pick<PiExtensionApi, "registerTool" | "registerCommand">, deps: RecallSurfaceDeps): void {
  api.registerTool?.({
    name: "recall",
    label: "Recall Signal",
    description: "Signal the recall layer: 'acknowledge' confirms you follow the current anchor version; "
      + "'refresh' declares the anchor stale and asks its provider for a new version; 'configure' applies "
      + "a bounded parameter patch (shadow/off and numeric knobs only) when a config-hint asks for it — "
      + "load skill recall-config first. 'emit' is never available to you.",
    promptSnippet: "recall: acknowledge the anchor, request a refresh, or apply a bounded configure after a config-hint",
    parameters: RECALL_PARAMETERS,
    execute: (_id, params) => executeRecallSignal(params, deps),
  });
  api.registerCommand?.("recall", {
    description: "机械查看当前 recall 策略与状态（只读，无正文）",
    handler: async (_args, ctx) => {
      const core = deps.core();
      const anchor = core ? readAnchor(deps.anchors)?.metadata : undefined;
      ctx.ui.notify(renderRecallView(core?.getState(), anchor), "info");
    },
  });
}
