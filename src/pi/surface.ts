/** 会话面：恰好一个 recall 信号工具与一个 /recall 只读命令；无正文、零宿主类型依赖。 */
import type { AnchorMetadata, PolicyCore, PolicyState } from "../core/index.js";
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
}

const ACTIONS = ["acknowledge", "refresh"] as const;

/** TypeBox 兼容 JSON Schema 字面量；保持包零运行时依赖。 */
const RECALL_PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", enum: ACTIONS,
      description: "acknowledge=确认收到当前锚点版本；refresh=声明锚点过时、请求 AnchorProvider 升版本" },
  },
  required: ["action"],
  additionalProperties: false,
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

/** 执行一次召回信号；写面只有 acknowledge/refresh，配置面对模型整体不存在。 */
export async function executeRecallSignal(params: unknown, deps: RecallSurfaceDeps): Promise<PiToolResult> {
  const core = deps.core();
  if (!core) return fail("closed: recall core is not running");
  let action: string;
  try {
    const raw = object(params, "params", ["action"]);
    member(raw.action, ACTIONS, "params.action");
    action = raw.action as string;
  } catch {
    return fail(`unknown-action: expected one of ${ACTIONS.join("/")}`);
  }
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
    description: "Signal the recall layer about the current anchor: 'acknowledge' confirms you received "
      + "and will follow the current anchor version; 'refresh' declares the anchor stale and asks its "
      + "provider for a new version. Signals are weak evidence only and never change policy configuration.",
    promptSnippet: "recall: acknowledge the current anchor or request an anchor refresh",
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
