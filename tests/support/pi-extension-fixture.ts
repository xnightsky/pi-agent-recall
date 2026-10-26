import { config } from "./fixtures.js";
import { createPiRecallExtension, type PiExtensionApi, type PiRecallTrace } from "../../src/pi/extension.js";

/** 可控 ExtensionAPI；只记录注册表并同步触发真实 extension handler。 */
export function piExtensionFixture(incarnations = ["runtime-test"]) {
  const handlers = new Map<string, Array<(event: unknown) => unknown>>();
  const traces: PiRecallTrace[] = [];
  let runtimeIndex = 0;
  const api: PiExtensionApi = { on(event, handler) {
    handlers.set(event, [...(handlers.get(event) ?? []), handler]);
  } };
  createPiRecallExtension({
    scope: "session-a", owner: "owner",
    createIncarnation: () => incarnations[Math.min(runtimeIndex++, incarnations.length - 1)]!,
    config: config({ cooldownMs: 0, dedupeMs: 0 }),
    anchors: { current: () => ({ ref: { provider: "roles", id: "current" }, version: "v1", content: "ANCHOR" }) },
    now: () => 0, trace: entry => traces.push(entry),
  })(api);
  return { traces, fire(event: string, payload: unknown): unknown {
    let result: unknown;
    for (const handler of handlers.get(event) ?? []) result = handler(payload) ?? result;
    return result;
  } };
}
