/**
 * @module tests/integration/pi-pty
 * 真实 Pi TUI + 固定假端点的零费用载具验证；不是 recall adapter 或 adopted 证明。
 * 不变量：显式 opt-in、钉版本、先验证 OS 网络门禁、无保护不启动、finally 清理。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { loadSuite, type SuiteModules, type SuiteSandbox as SandboxContext } from "../support/suite-types.js";
import { createPiFixtureProfile, isolatePiEnvironment } from "../support/pi-fixture.js";
import { findExecutable, piInstallation } from "../support/pi-host.js";
import { verifyNetworkIsolation } from "../support/pi-network.js";

function assertLocalSandbox(sandbox: SandboxContext): void {
  const parent = realpathSync(resolve(".tmp/pi-pty"));
  for (const path of [tmpdir(), sandbox.homeDir, sandbox.cwd]) {
    const location = relative(parent, realpathSync(path));
    assert.ok(location && !location.startsWith(".."), "sandbox must stay inside this repository");
  }
}

function assertPidExited(pid: number): void {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "host PID receipt required");
  assert.throws(() => process.kill(pid, 0), (error: unknown) =>
    (error as NodeJS.ErrnoException).code === "ESRCH", "recorded Pi process must have exited");
}

async function runFixture(entry: string, sandboxExecutable: string, suite: SuiteModules) {
  const { createPtyAgentDriver, FakeProviderBackend } = suite;
  const marker = `RECALL_PTY_${randomUUID().replaceAll("-", "")}`;
  const prompt = "Run the isolated transport check.";
  const backend = new FakeProviderBackend({ wire: "openai-chat", script: [{ text: marker }] });
  assert.equal(backend.mode, "fixture");
  let sandbox: SandboxContext | undefined;
  const evidence: Record<string, unknown> = { version: "1.4.0", suite: "0.6.1", marker, prompt, passed: false };
  const driver = createPtyAgentDriver({
    profile: createPiFixtureProfile(entry), backend, injectServer: false,
    commandOverride: { command: sandboxExecutable, argsPrefix: [] },
    readyTimeoutMs: 30_000, promptTimeoutMs: 30_000,
    sandboxSetup: async (created) => {
      sandbox = created;
      assertLocalSandbox(created);
      await isolatePiEnvironment(created);
      evidence.environmentKeys = Object.keys(created.env).sort();
      await verifyNetworkIsolation(created, sandboxExecutable);
      evidence.networkGuard = "allowed fixture port; EPERM/EACCES denied other loopback + 192.0.2.1";
    },
    sandboxTeardown: async (created) => {
      const receipt = join(created.cwd, "pi.pid");
      if (existsSync(receipt)) {
        evidence.pid = Number(await readFile(receipt, "utf8"));
        assertPidExited(Number(evidence.pid));
      }
    },
  });
  const errors: unknown[] = [];
  try {
    await driver.start();
    evidence.pid = Number(await readFile(join(driver.sandbox.cwd, "pi.pid"), "utf8"));
    assert.match(driver.screenTail(), /1\.4\.0/);
    const observation = await driver.sendPrompt(prompt);
    evidence.screen = observation.text;
    assert.equal(backend.requests().length, 1);
    const request = backend.requests()[0] as { model?: unknown; messages?: unknown; tools?: unknown };
    assert.equal(request.model, "fake");
    assert.ok(JSON.stringify(request.messages).includes(prompt));
    assert.ok(!JSON.stringify(request).includes(marker), "response marker must not be a prompt echo");
    assert.ok(request.tools === undefined || (Array.isArray(request.tools) && request.tools.length === 0));
    assert.ok(observation.text.includes(marker));
  } catch (error) { errors.push(error); }
  finally {
    evidence.requests = backend.requests();
    await finishFixture(driver, sandbox, evidence, errors);
  }
  if (errors.length) throw new AggregateError(errors, "Pi PTY fixture failed; see .tmp/pi-pty-evidence.json");
  return evidence;
}

async function finishFixture(
  driver: { close(reason: string): Promise<void> }, sandbox: SandboxContext | undefined,
  evidence: Record<string, unknown>, errors: unknown[],
): Promise<void> {
  try { await driver.close("zero-token fixture complete"); }
  catch (error) { errors.push(error); }
  try {
    if (sandbox) {
      assert.equal(existsSync(sandbox.homeDir), false, "temporary HOME must be deleted");
      assert.equal(existsSync(sandbox.cwd), false, "temporary cwd must be deleted");
      evidence.directoriesRemoved = true;
    }
    if (evidence.pid !== undefined) {
      assertPidExited(Number(evidence.pid));
      evidence.hostPidExited = true;
    }
  } catch (error) { errors.push(error); }
  evidence.passed = errors.length === 0;
  evidence.errors = errors.map((error) => String(error));
  await writeFile(resolve(".tmp/pi-pty-evidence.json"), JSON.stringify(evidence, null, 2));
}

test("Pi 1.4.0 PTY：隔离网络中的真实 TUI 完成一次 fixture 请求并退出", {
  skip: process.env.E2E_PI_PTY !== "1" ? "requires E2E_PI_PTY=1" : false,
  timeout: 90_000,
}, async (context) => {
  if (process.platform !== "darwin") return context.skip("requires macOS sandbox-exec network guard");
  const suite = await loadSuite();
  if (!suite) return context.skip("x-agent-suite 未安装（可选依赖，见 docs/testing.md）");
  if (Number(process.versions.node.split(".")[0]) < 24) return context.skip("x-agent-suite requires Node >=24");
  const sandboxExecutable = findExecutable("sandbox-exec");
  if (!sandboxExecutable) return context.skip("sandbox-exec not installed");
  const installation = piInstallation();
  if (!installation) return context.skip("Pi CLI not installed");
  if (installation.version !== "1.4.0") return context.skip(`unverified Pi version: ${installation.version}`);
  assert.notEqual(process.env.E2E_KEEP_SANDBOX, "1", "retaining sandbox is not supported by this test");
  const evidence = await runFixture(installation.entry, sandboxExecutable, suite);
  context.diagnostic(`Pi ${evidence.version}; x-agent-suite ${evidence.suite}; requests=1; PID exited; directories removed`);
});
