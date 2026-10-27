/**
 * @module tests/support/pi-fixture
 * 消费者自持的 Pi 测试 profile，不属于生产 adapter。
 * 不变量：只有 fixture、精确 loopback 端点、禁资源/工具；不借用宿主登录态。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SuiteSandbox as SandboxContext, SuiteWriteConfigContext as WriteConfigContext } from "./suite-types.js";

/** 校验无认证/路径/query 的显式 IPv4 loopback 端口。 */
export function loopbackPort(baseUrl: string): number {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(baseUrl)) {
    throw new Error("fixture requires an exact loopback baseUrl");
  }
  const port = Number(baseUrl.slice(baseUrl.lastIndexOf(":") + 1));
  if (!Number.isSafeInteger(port) || port > 65535) throw new Error("invalid loopback port");
  return port;
}

function piHome(sandbox: SandboxContext): string {
  const home = sandbox.configDirs?.piHome;
  if (home !== join(sandbox.homeDir, "piHome")) throw new Error("invalid fixture config directory");
  return home;
}

/** 用新建目录与固定值替换全部继承环境，包括未知认证变量与预加载。 */
export async function isolatePiEnvironment(sandbox: SandboxContext): Promise<void> {
  const home = piHome(sandbox);
  const temporary = join(sandbox.homeDir, "tmp");
  await mkdir(temporary, { recursive: true });
  for (const key of Object.keys(sandbox.env)) delete sandbox.env[key];
  Object.assign(sandbox.env, {
    HOME: sandbox.homeDir, PATH: dirname(process.execPath),
    TMPDIR: temporary, TMP: temporary, TEMP: temporary,
    XDG_CONFIG_HOME: join(sandbox.homeDir, "config"),
    XDG_CACHE_HOME: join(sandbox.homeDir, "cache"),
    XDG_DATA_HOME: join(sandbox.homeDir, "data"),
    PI_CODING_AGENT_DIR: home, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
    PI_NO_TITLE: "1", TERM: "xterm-256color", LANG: "en_US.UTF-8",
  });
}

async function writeConfig(sandbox: SandboxContext, context: WriteConfigContext): Promise<void> {
  if (context.live !== undefined || context.injectServer !== false) {
    throw new Error("Pi test profile only accepts fixture without MCP");
  }
  const port = loopbackPort(context.baseUrl);
  if (!context.apiKey || /^[!$]/.test(context.apiKey)) throw new Error("invalid fixture credential");
  const provider = { baseUrl: `${context.baseUrl}/v1`, api: "openai-completions", apiKey: context.apiKey,
    models: [{ id: "fake", name: "Recall Fixture", reasoning: false, input: ["text"],
      contextWindow: 128000, maxTokens: 256,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] };
  const settings = {
    defaultProvider: "recall-fixture", defaultModel: "fake", defaultThinkingLevel: "off",
    enabledModels: ["recall-fixture/fake"], packages: [], defaultTools: [],
    cacheWarming: "off", compaction: { enabled: false },
    retry: { enabled: false, provider: { maxRetries: 0 } },
    enableInstallTelemetry: false, enableAnalytics: false, defaultProjectTrust: "never",
    quietStartup: false, theme: "dark", tuiMode: "regular",
  };
  for (const [name, data] of Object.entries({ "models.json": { providers: { "recall-fixture": provider } },
    "settings.json": settings, "auth.json": {}, "mcp.json": { mcpServers: {} } })) {
    await writeFile(join(piHome(sandbox), name), JSON.stringify(data), "utf8");
  }
  await writeFile(join(sandbox.cwd, "network.sb"), [
    "(version 1)", "(allow default)", "(deny network*)",
    `(allow network-outbound (remote ip "localhost:${port}"))`, "",
  ].join("\n"));
  // 只记录本次宿主 PID，不导入任何 Pi 扩展或继承 NODE_OPTIONS。
  await writeFile(join(sandbox.cwd, "record-pid.mjs"),
    'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./pi.pid", import.meta.url), String(process.pid));\n');
}

/** 创建固定 CLI 入口、假端点与网络封锁的真实 PTY 测试 profile；仅允许显式测试扩展。返回类型靠推断，与套件 HarnessProfile 结构化兼容。 */
export function createPiFixtureProfile(cliEntry: string, extension?: string, keepExtensionTools = false) {
  return {
    name: "recall-pi-fixture", command: "sandbox-exec", wire: "openai-chat",
    baseUrlEnv: "", stripEnv: Object.keys(process.env), supportsFixture: true,
    sandbox: { configDirs: ["piHome"] },
    configDirEnv: { env: "PI_CODING_AGENT_DIR", sandboxDir: "piHome" },
    headlessArgs: () => { throw new Error("this fixture only supports PTY"); },
    ptyArgs: ({ cwd }: { cwd: string }) => [
      "-f", join(cwd, "network.sb"), process.execPath, "--import", join(cwd, "record-pid.mjs"), cliEntry,
      "--provider", "recall-fixture", "--model", "fake", "--thinking", "off",
      "--offline", "--no-session", "--no-approve", "--no-extensions", "--no-mcp",
      ...(extension ? ["--extension", extension] : []),
      "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
      // --no-tools 连扩展工具一并禁用；--no-builtin-tools 保留扩展工具供会话面场景。
      keepExtensionTools ? "--no-builtin-tools" : "--no-tools",
    ],
    ptyReadyPattern: /v1\.4\.0[\s\S]*0\.0%\/128k[ \t]+fake/,
    ptyIdlePatterns: [/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].*/g],
    toolName: () => { throw new Error("fixture has no tools"); },
    createParser: () => () => null, writeConfig,
  };
}
