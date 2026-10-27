/** 测试专用 Pi entry；从隔离 cwd 读取场景，不进入生产 adapter 或公共 exports。 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPolicyCore, type PolicyCore } from "../../src/core/index.js";
import { createPiRecallExtension, type PiExtensionApi } from "../../src/pi/extension.js";

interface FixtureScenario {
  name: string;
  marker: string;
  mode?: "off" | "emit";
  allowReanchor: boolean;
  allowWake: boolean;
  missingAnchor?: boolean;
  singleAnchor?: boolean;
  versionChange?: boolean;
  activityBeforePrepare?: boolean;
  sinkFailure?: boolean;
  wakeBudget?: number;
  externalContinuation?: boolean;
  /** 去重窗口；缺省 0（不去重），config-hint 场景需要正窗口制造 duplicate。 */
  dedupeMs?: number;
}

function loadScenario(): FixtureScenario {
  const data = JSON.parse(readFileSync(join(process.cwd(), "recall-scenario.json"), "utf8")) as FixtureScenario;
  if (!data.name || !data.marker || typeof data.allowReanchor !== "boolean" || typeof data.allowWake !== "boolean") {
    throw new Error("invalid recall fixture scenario");
  }
  return data;
}

/** 由 -ne -e 显式加载的零 token 测试扩展。 */
export default function recallFixture(pi: unknown): void {
  const scenario = loadScenario();
  const api = pi as PiExtensionApi;
  let reads = 0;
  let externalContinuations = 0;
  api.on("agent_before_settle", raw => {
    const event = raw as { outcome: string; continue: boolean;
      context: { canContinue: boolean; pendingMessages: readonly unknown[] } };
    appendFileSync(join(process.cwd(), "recall-trace.jsonl"), JSON.stringify({ event: "boundary",
      outcome: event.outcome, continue: event.continue, canContinue: event.context.canContinue,
      pending: event.context.pendingMessages.length }) + "\n");
    if (scenario.externalContinuation && externalContinuations++ === 0) return {
      entries: [{ type: "custom_message", customType: "fixture.external.continuation",
        content: "EXTERNAL_CONTINUATION", display: false }], continue: true };
    return undefined;
  });
  createPiRecallExtension({
    scope: "fixture-session", owner: "fixture-owner",
    config: { context: {
      host: "pi", hostVersion: "1.4.0", provider: "recall-fixture", model: "fake",
      modelRevision: "1", taskFamily: "v2-fixture", roleTopology: "single",
      policyVersion: "v2-fixture-1", reminderTextVersion: "1",
    }, override: {
      mode: scenario.mode ?? "emit", allowReanchor: scenario.allowReanchor, allowWake: scenario.allowWake,
      cooldownMs: 0, wakeCooldownMs: 0, dedupeMs: scenario.dedupeMs ?? 0, maxAttemptsPerEpoch: 4, maxWakePerEpoch: scenario.wakeBudget ?? 1,
      reservationTtlMs: 5_000, wakeTtlMs: 5_000,
    } },
    anchors: { current: () => {
      const read = reads++;
      if (scenario.missingAnchor || (scenario.singleAnchor && read >= 2)) return undefined;
      const version = scenario.versionChange && read > 0 ? "v2" : "v1";
      return { ref: { provider: "fixture", id: scenario.name }, version, content: scenario.marker };
    } },
    createCore: (incarnation, config): PolicyCore => {
      const core = createPolicyCore({ scope: "fixture-session", owner: "fixture-owner", incarnation, config });
      let injected = false;
      return {
        evaluate: input => core.evaluate(input),
        prepareDelivery: (id, input) => {
          if (scenario.activityBeforePrepare && !injected) {
            injected = true;
            // 嵌套转换不得随意推进时钟：用实例已知时刻消除 1ms 窗口竟态，fence 失效语义不变。
            core.transition({ kind: "activity", fence: core.getState().fence, provenance: "external", now: core.getState().now });
          }
          try { return core.prepareDelivery(id, input); }
          catch (error) {
            appendFileSync(join(process.cwd(), "recall-prepare-error.json"), JSON.stringify({ error: String(error),
              inputNow: input.now, runtimeNow: core.getState().now, fence: core.getState().fence }));
            throw error;
          }
        },
        commitDelivery: (permit, result, now) => core.commitDelivery(permit, result, now),
        applyConfig: next => core.applyConfig(next), transition: event => core.transition(event),
        close: () => core.close(), getState: () => core.getState(),
      };
    },
    now: () => Date.now(),
    trace: entry => appendFileSync(join(process.cwd(), "recall-trace.jsonl"), JSON.stringify(entry) + "\n"),
    ...(scenario.sinkFailure ? { sink: { accept: () => { throw new Error("fixture sink failure"); } } } : {}),
  })(api);
}
