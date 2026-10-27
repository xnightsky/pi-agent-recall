/**
 * @module tests/support/suite-types
 * x-agent-suite 的最小结构类型与可选加载器。
 * 不变量：套件是可选 devDependency；任何文件不得静态 import 它，
 * 缺失时调用方显式 skip，不得让 pnpm install / pnpm check 失败。
 */

/** 套件 sandbox 的本仓消费面。 */
export interface SuiteSandbox {
  id: string;
  cwd: string;
  homeDir: string;
  env: Record<string, string>;
  configDirs?: Record<string, string | undefined>;
}

/** 套件 writeConfig 上下文的本仓消费面；injectServer/live/server 仅用于拒绝路径。 */
export interface SuiteWriteConfigContext {
  baseUrl: string;
  apiKey: string;
  injectServer: boolean;
  live?: unknown;
  server?: unknown;
}

/** 假端点脚本轮；索引 = 请求体内 tool result 轮数，whenText 内容命中优先。 */
export interface SuiteFixtureTurn {
  toolCall?: { name: string; args: unknown };
  text?: string;
  whenText?: string;
  delayMs?: number;
}

/** FakeProviderBackend 的本仓消费面。 */
export interface SuiteBackend {
  readonly mode: string;
  start(): Promise<SuiteWriteConfigContext>;
  requests(): unknown[];
  stop(): Promise<void>;
}

/** createPtyAgentDriver 返回驱动器的本仓消费面。 */
export interface SuiteDriver {
  readonly sandbox: SuiteSandbox;
  start(): Promise<void>;
  sendPrompt(text: string): Promise<{ text: string }>;
  screenTail(): string;
  close(reason: string): Promise<void>;
}

/** createPtyAgentDriver 参数的本仓消费面；profile 由 createPiFixtureProfile 推断，套件侧结构化兼容。 */
export interface SuiteDriverOptions {
  profile: unknown;
  backend: SuiteBackend;
  injectServer: false;
  commandOverride: { command: string; argsPrefix: string[] };
  readyTimeoutMs: number;
  promptTimeoutMs: number;
  sandboxSetup(created: SuiteSandbox): Promise<void>;
  sandboxTeardown?(created: SuiteSandbox): Promise<void>;
}

/** 套件两个模块的运行时入口。 */
export interface SuiteModules {
  FakeProviderBackend: new (options: { wire: string; script: readonly SuiteFixtureTurn[] }) => SuiteBackend;
  createPtyAgentDriver(options: SuiteDriverOptions): SuiteDriver;
}

/**
 * 可选加载 x-agent-suite；缺失返回 undefined（调用方负责 skip）。
 * 计算式 specifier 阻止 tsc 静态解析，套件缺席时 typecheck 仍通过。
 */
export async function loadSuite(): Promise<SuiteModules | undefined> {
  const specifier = (name: string): string => name;
  try {
    const fixture = await import(specifier("x-agent-suite/llm-fixture")) as {
      FakeProviderBackend: SuiteModules["FakeProviderBackend"];
    };
    const driver = await import(specifier("@x-agent-suite/pty-driver")) as {
      createPtyAgentDriver: SuiteModules["createPtyAgentDriver"];
    };
    return { FakeProviderBackend: fixture.FakeProviderBackend, createPtyAgentDriver: driver.createPtyAgentDriver };
  } catch {
    return undefined;
  }
}
