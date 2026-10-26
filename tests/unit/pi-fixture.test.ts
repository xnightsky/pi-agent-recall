/**
 * @module tests/unit/pi-fixture
 * 测试载具的安全门禁；不启动 Pi，也不连接真实 provider。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { test } from "node:test";
import type { SandboxContext } from "x-agent-suite/contracts";
import { createPiFixtureProfile, isolatePiEnvironment, loopbackPort } from "../support/pi-fixture.js";
import { integrationTestFiles } from "../support/test-files.js";
import { FakeProviderBackend } from "x-agent-suite/llm-fixture";
import { findExecutable } from "../support/pi-host.js";
import { verifyNetworkIsolation } from "../support/pi-network.js";

async function withSandbox(run: (sandbox: SandboxContext) => Promise<void>) {
  const parent = resolve(".tmp/pi-fixture-unit");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  const homeDir = join(root, "home");
  const cwd = join(root, "cwd");
  const piHome = join(homeDir, "piHome");
  await mkdir(piHome, { recursive: true });
  await mkdir(cwd);
  try {
    await run({ id: "unit", homeDir, cwd, configDirs: { piHome }, env: {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("集成发现按完整后缀排除 token 文件，不依赖目录或标题", () => {
  assert.deepEqual(integrationTestFiles([
    "integration/pi.ittest.ts", "integration/pi.token.ittest.ts",
    "integration/token/zero.ittest.ts", "unit/a.test.ts", "pi.ittest.ts.bak",
  ]), ["integration/pi.ittest.ts", "integration/token/zero.ittest.ts"]);
});

test("fake baseUrl 只接受无认证/路径/query 的显式 IPv4 loopback 端口", () => {
  assert.equal(loopbackPort("http://127.0.0.1:12345"), 12345);
  for (const url of ["https://127.0.0.1:12", "http://localhost:12", "http://example.com:12",
    "http://user@127.0.0.1:12", "http://127.0.0.1:12/v1", "http://127.0.0.1:12?x=1",
    "http://127.0.0.1", "http://127.0.0.1:0", "http://127.0.0.1:12#x"]) {
    assert.throws(() => loopbackPort(url), /loopback/);
  }
});

test("环境白名单清除未知凭据、代理、Node 预加载、宿主配置及 keep 标志", async () => {
  await withSandbox(async (sandbox) => {
    Object.assign(sandbox.env, { SECRET_NEW_PROVIDER_KEY: "sentinel", NODE_OPTIONS: "sentinel",
      HTTPS_PROXY: "sentinel", PI_CODING_AGENT_DIR: "sentinel", E2E_KEEP_SANDBOX: "1" });
    await isolatePiEnvironment(sandbox);
    assert.equal(Object.values(sandbox.env).includes("sentinel"), false);
    assert.equal(sandbox.env.E2E_KEEP_SANDBOX, undefined);
    assert.equal(sandbox.env.HOME, sandbox.homeDir);
    assert.equal(sandbox.env.PI_CODING_AGENT_DIR, sandbox.configDirs!.piHome);
    assert.equal(sandbox.env.PI_OFFLINE, "1");
    assert.equal(sandbox.env.TMPDIR, join(sandbox.homeDir, "tmp"));
  });
});

test("Pi profile 拒绝 live/MCP/外部端点，配置只绑定 fixture", async () => {
  await withSandbox(async (sandbox) => {
    const profile = createPiFixtureProfile(process.execPath);
    const context = { injectServer: false as const, baseUrl: "http://127.0.0.1:12345", apiKey: "fixture-only" };
    await assert.rejects(profile.writeConfig(sandbox, { ...context, live: {} }), /fixture/);
    await assert.rejects(profile.writeConfig(sandbox, {
      ...context, injectServer: true, server: { command: "forbidden", args: [] },
    }), /fixture/);
    await assert.rejects(profile.writeConfig(sandbox, { ...context, baseUrl: "https://example.com" }), /loopback/);
    await profile.writeConfig(sandbox, context);
    const config = JSON.parse(await readFile(join(sandbox.configDirs!.piHome!, "models.json"), "utf8"));
    assert.deepEqual(Object.keys(config.providers), ["recall-fixture"]);
    assert.equal(config.providers["recall-fixture"].baseUrl, `${context.baseUrl}/v1`);
    const settings = JSON.parse(await readFile(join(sandbox.configDirs!.piHome!, "settings.json"), "utf8"));
    assert.deepEqual(settings.packages, []);
    assert.equal(settings.cacheWarming, "off");
    assert.equal(settings.retry.enabled, false);
    const args = profile.ptyArgs!({ cwd: sandbox.cwd });
    for (const flag of ["--offline", "--no-session", "--no-approve", "--no-extensions",
      "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-tools"]) {
      assert.ok(args.includes(flag), flag);
    }
    assert.equal(args.includes("--extension"), false);
  });
});

test("禁用发现扩展时仍只加载显式 recall fixture", async () => {
  await withSandbox(async (sandbox) => {
    const extension = resolve("tests/support/pi-recall-extension.ts");
    const profile = createPiFixtureProfile(process.execPath, extension);
    const args = profile.ptyArgs!({ cwd: sandbox.cwd });
    assert.equal(args.includes("--no-extensions"), true);
    const index = args.indexOf("--extension");
    assert.ok(index >= 0);
    assert.equal(args[index + 1], extension);
    assert.equal(args.filter(arg => arg === "--extension").length, 1);
  });
});

test("OS 网络门禁：允许本次端口，其余端口与非 loopback 被拒绝", {
  skip: process.platform !== "darwin" || !findExecutable("sandbox-exec"), timeout: 15_000,
}, async () => {
  await withSandbox(async (sandbox) => {
    const backend = new FakeProviderBackend({ wire: "openai-chat", script: [{ text: "fixture" }] });
    try {
      const context = await backend.start();
      await createPiFixtureProfile(process.execPath).writeConfig(sandbox, { ...context, injectServer: false });
      await isolatePiEnvironment(sandbox);
      await verifyNetworkIsolation(sandbox, findExecutable("sandbox-exec")!);
      assert.equal(backend.requests().length, 0);
    } finally {
      await backend.stop();
    }
  });
});

test("Pi 1.4.0 就绪判据识别实际 footer，不沿用旧 provider 括号", () => {
  const ready = createPiFixtureProfile(process.execPath).ptyReadyPattern!;
  assert.equal(ready.test("v1.4.0\n0.0%/128k                                                                   fake"), true);
  assert.equal(ready.test("0.0%/128k                                                                   fake"), false);
  assert.equal(ready.test("Model scope: fake (Ctrl+P to cycle)"), false);
});
