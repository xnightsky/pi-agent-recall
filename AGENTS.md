# AGENTS.md

<!-- shared:begin -->
## 响应与规则加载

- 始终使用简体中文。
- 进入仓库后先在根目录运行 `rg --files --max-depth 1 -g 'AGENTS.md' -g 'AGENTS.*.md'`。
- AI 必须同时读取根 `AGENTS.ai.md`；后续若新增 `AGENTS.<platform>.md`，仅在命中对应平台时读取。
- 进入子目录前检查该边界是否有局部 `AGENTS.md` 或 `AGENTS.*.md`。
- 发现边界冲突、设计冲突、阶段切口冲突或隐藏的全局一致性风险时，第一时间用 `**[冲突提示]**` 高亮提示用户，写明冲突点、影响范围和建议停点，不等到实现后集中暴露。

## 代码与测试

- 遵循 DRY、KISS、SOLID、YAGNI；只改需求直接涉及的代码。
- 单函数尽量不超过 50 行，单文件超过 500 行必须拆分。
- 所有导出符号写中文 JSDoc；入口和跨边界文件写模块头与不变量注释。
- 新行为先写失败测试，再实现；错误必须显式处理，禁止静默失败。

### 测试分层约定（适用全仓所有 `*test*` 文件）

- 只有两类默认测试：单元测试（`*.test.ts`，`pnpm test`）与集成测试（`*.ittest.ts`，`pnpm ittest`）。
- 分类看验证对象与代价，不看是否起子进程：纯 fake、进程内组件、loopback 假端点、通用测试子进程均归单元测试，只要不拉起真实宿主 CLI 且零 token。
- 拉起真实宿主 CLI、经 sandbox + 假端点验证真实宿主路径的归集成测试；该层必须零 token，可按显式前置条件 skip。
- live 模式打真实 provider、会产生真实 token/费用的测试统一命名 `*.token.ittest.ts`，不进 `pnpm test`/`pnpm ittest`/`pnpm check` 任何默认回归，只能经显式 `ittest:token:*` 脚本运行。
- 默认 runner 按完整后缀排除所有 `*.token.ittest.ts`；目录只负责组织，不承担安全语义。
- 保留的终止后缀只有 `*.test.ts`、`*.ittest.ts`、`*.token.ittest.ts`；PTY、headless、sandbox 是机制，smoke/contract 是范围或目的，只写在文件 stem 与测试标题，不组合成新的官方后缀。

## 安全与文档

- 禁止硬编码密钥、token、用户目录或本机绝对路径。
- 行为、协议、使用和验证变化必须同步 `docs/`（有 skill 产物的仓同步 skill）。
- 最终汇报必须列出已验证项、未验证项、剩余风险和注释收口范围。

## Git

- Commit 使用 Conventional Commits，中文摘要，不添加 AI 小尾巴。
- 禁止 force push；未经当前会话明确授权，不执行 commit、push 或远程写入。
<!-- shared:end -->

## 项目边界

- 本库是模型注意力策略，不是 cron、业务 scheduler、记忆库或消息设施。
- `core` 无宿主依赖、无 I/O；只接收确定性事实与无正文锚点元数据。
- 消费者拥有 AnchorProvider；宿主组合根拥有唯一 session emit owner。core/testing 与 `/pi` adapter 已交付；生产 AnchorProvider、双消费者迁移与模型效果验证另行评审。
- 只在本仓写入；相邻仓只读。无额外授权不发布、提交或远程写入。
- 调整公共契约时读取 `docs/architecture/core.md`；调整测试与实验时读取 `docs/testing.md`。

## 结构与命名

- 单包，`src/core/`、`src/testing/` 与 `src/pi/`；导出入口 `/core`、`/testing`、`/pi`，不提前提供未实现入口。
- 文件和目录用 kebab-case；类型 PascalCase，函数/变量 camelCase。
- `tests/unit/*.test.ts` 与 `tests/support/`。未来真实宿主测试使用 `tests/integration/**/*.ittest.ts`；付费模型实验只能显式运行 `*.token.ittest.ts`。
- 文档分层与 frontmatter 见 `docs/README.md`；本仓不含 skill，不复制下游技能；`/pi` extension 仅经 `pi-agent-recall/pi` 出口分发。
