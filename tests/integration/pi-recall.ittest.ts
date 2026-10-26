/**
 * @module tests/integration/pi-recall
 * 真实 Pi 加载测试 recall adapter；固定假端点，零真实 token。
 * 不变量：显式扩展、精确请求数、原始请求证据、finally 清理。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { test } from "node:test";
import type { SandboxContext } from "x-agent-suite/contracts";
import { FakeProviderBackend } from "x-agent-suite/llm-fixture";
import { createPiFixtureProfile, isolatePiEnvironment } from "../support/pi-fixture.js";
import { findExecutable, piInstallation } from "../support/pi-host.js";
import { verifyNetworkIsolation } from "../support/pi-network.js";

interface Scenario {
  name: string;
  prompts: string[];
  responses: number;
  allowReanchor: boolean;
  allowWake: boolean;
  mode?: "off" | "emit";
  missingAnchor?: boolean;
  singleAnchor?: boolean;
  versionChange?: boolean;
  activityBeforePrepare?: boolean;
  sinkFailure?: boolean;
  wakeBudget?: number;
  externalContinuation?: boolean;
  verify(requests: string[], traces: Array<Record<string, unknown>>, marker: string): void;
}

const scenarios: Scenario[] = [
  { name: "reanchor-request-local", prompts: ["first", "second"], responses: 2,
    allowReanchor: true, allowWake: false, singleAnchor: true, verify(requests, traces, marker) {
      assert.equal(requests.length, 2);
      assert.ok(requests[0]!.includes(marker));
      assert.ok(!requests[1]!.includes(marker));
      assert.equal(traces.filter(row => row.event === "reanchor" && row.delivered === true).length, 1);
    } },
  { name: "reanchor-version-change", prompts: ["version"], responses: 1,
    allowReanchor: true, allowWake: false, versionChange: true, verify(requests, traces, marker) {
      assert.equal(requests.length, 1);
      assert.ok(!requests[0]!.includes(marker));
      assert.equal(traces.some(row => row.reason === "anchor-changed"), true);
    } },
  { name: "activity-before-prepare", prompts: ["activity"], responses: 1,
    allowReanchor: true, allowWake: false, activityBeforePrepare: true, verify(requests, traces, marker) {
      assert.equal(requests.length, 1);
      assert.ok(!requests[0]!.includes(marker));
      assert.equal(traces.some(row => row.reason === "stale-reservation"), true);
    } },
  { name: "wake-self-and-external", prompts: ["wake", "external"], responses: 4,
    allowReanchor: false, allowWake: true, wakeBudget: 2, verify(requests, traces, marker) {
      assert.equal(requests.length, 4);
      assert.ok(!requests[0]!.includes(marker));
      assert.ok(requests[1]!.includes(marker));
      assert.ok(requests[2]!.includes(marker), "历史 wake custom message 可留在后续上下文");
      assert.ok(requests[3]!.includes(marker));
      assert.equal(traces.filter(row => row.event === "wake" && row.delivered === true).length, 2);
      assert.equal(traces.some(row => row.event === "wake" && row.reason === "self-trigger"), true);
    } },
  { name: "existing-continuation", prompts: ["continue"], responses: 3,
    allowReanchor: false, allowWake: true, externalContinuation: true, verify(requests, traces, marker) {
      assert.equal(requests.length, 3);
      assert.ok(!requests[0]!.includes(marker));
      assert.ok(!requests[1]!.includes(marker));
      assert.ok(requests[2]!.includes(marker));
      assert.equal(traces.filter(row => row.event === "wake" && row.delivered === true).length, 1);
    } },
  { name: "off", prompts: ["off"], responses: 1,
    allowReanchor: true, allowWake: true, mode: "off", verify(requests, _traces, marker) {
      assert.equal(requests.length, 1);
      assert.ok(requests.every(request => !request.includes(marker)));
    } },
  { name: "missing-anchor", prompts: ["missing"], responses: 1,
    allowReanchor: true, allowWake: true, missingAnchor: true, verify(requests, traces, marker) {
      assert.equal(requests.length, 1);
      assert.ok(!requests[0]!.includes(marker));
      assert.equal(traces.some(row => row.reason === "missing-anchor"), true);
    } },
  { name: "sink-failed-no-retry", prompts: ["failed"], responses: 1,
    allowReanchor: false, allowWake: true, sinkFailure: true, verify(requests, traces, marker) {
      assert.equal(requests.length, 1);
      assert.ok(!requests[0]!.includes(marker));
      assert.equal(traces.some(row => row.reason === "sink-failed"), true);
    } },
];

async function runScenario(scenario: Scenario, entry: string, sandboxExecutable: string): Promise<void> {
  const { createPtyAgentDriver } = await import("@x-agent-suite/pty-driver");
  const marker = `RECALL_${scenario.name}_${randomUUID().replaceAll("-", "")}`;
  const backend = new FakeProviderBackend({ wire: "openai-chat",
    script: Array.from({ length: scenario.responses }, (_, index) => ({ text: `response-${index}` })) });
  let sandbox: SandboxContext | undefined;
  const driver = createPtyAgentDriver({
    profile: createPiFixtureProfile(entry, resolve("tests/support/pi-recall-extension.ts")),
    backend, injectServer: false, commandOverride: { command: sandboxExecutable, argsPrefix: [] },
    readyTimeoutMs: 30_000, promptTimeoutMs: 30_000,
    sandboxSetup: async created => {
      sandbox = created;
      await isolatePiEnvironment(created);
      await writeFile(join(created.cwd, "recall-scenario.json"), JSON.stringify({ ...scenario, marker }));
      await verifyNetworkIsolation(created, sandboxExecutable);
    },
  });
  const errors: unknown[] = [];
  let requests: string[] = [];
  let traces: Array<Record<string, unknown>> = [];
  try {
    await driver.start();
    for (const prompt of scenario.prompts) await driver.sendPrompt(prompt);
    requests = backend.requests().map(request => JSON.stringify(request));
    traces = (await readFile(join(driver.sandbox.cwd, "recall-trace.jsonl"), "utf8"))
      .trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
    const errorPath = join(driver.sandbox.cwd, "recall-prepare-error.json");
    if (existsSync(errorPath)) traces.push({ event: "prepare-debug", detail: await readFile(errorPath, "utf8") });
  } catch (error) { errors.push(error); }
  finally {
    try { await driver.close("recall V2 scenario complete"); }
    catch (error) { errors.push(error); }
    await backend.stop();
  }
  if (sandbox) {
    assert.equal(existsSync(sandbox.homeDir), false);
    assert.equal(existsSync(sandbox.cwd), false);
  }
  if (errors.length) throw new AggregateError(errors, scenario.name);
  await writeFile(resolve(`.tmp/pi-recall-${scenario.name}.json`), JSON.stringify({ requests, traces }, null, 2));
  assert.equal(traces.some(row => row.event === "runtime"), true, "adapter 必须实际加载");
  assert.equal(traces.some(row => row.reason === "error"), false, "扩展错误必须失败");
  scenario.verify(requests, traces, marker);
}

test("Pi 1.4.0 加载 recall 测试 adapter 的 V2 场景", {
  skip: process.env.E2E_PI_PTY !== "1" ? "requires E2E_PI_PTY=1" : false,
  timeout: 180_000,
}, async context => {
  if (process.platform !== "darwin") return context.skip("requires macOS sandbox-exec network guard");
  if (Number(process.versions.node.split(".")[0]) < 24) return context.skip("x-agent-suite requires Node >=24");
  const sandboxExecutable = findExecutable("sandbox-exec");
  if (!sandboxExecutable) return context.skip("sandbox-exec not installed");
  const installation = piInstallation();
  if (!installation) return context.skip("Pi CLI not installed");
  if (installation.version !== "1.4.0") return context.skip(`unverified Pi version: ${installation.version}`);
  for (const scenario of scenarios) await runScenario(scenario, installation.entry, sandboxExecutable);
});
