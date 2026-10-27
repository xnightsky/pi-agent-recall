---
type: guide
---
# 验证与实验门禁

## 当前 V0 证据（2026-10-25）

阶段零收口时 `pnpm check` 为 **44/44**。追加 PTY 载具后实际复跑为 **50/50**（新增 6 项安全/发现/就绪单元测试），零失败/skip，typecheck 与 build 通过。包契约测试实际 build → pack → 在本仓 .tmp 中离线安装 → Node 消费 `/core` 与 `/testing` → TypeScript 消费 d.ts，且拒绝私有深层路径与包根。阶段零机制验证通过，不代表生产可用。

过程记录在 .tmp/progress.md；失败/通过日志包含 profile、公共类型消费、policy、delivery、lifecycle 边界、shadow、replay，以及包消费验证。新行为采用失败测试后实现；既有 profile 没有重复实现。

## 默认车道

```sh
pnpm test       # tests/unit/*.test.ts
pnpm typecheck
pnpm build
pnpm check      # test + typecheck + build
```

单元包括纯 fake、进程内机制、通用测试子进程和本地 tarball 消费；都零 token、不启动真实宿主 CLI。测试 glob 使用完整 `.test.ts` 后缀，不匹配 `.ittest.ts` 或 `.token.ittest.ts`。

真实宿主使用 `*.ittest.ts`，真实 provider 费用实验只能显式 `*.token.ittest.ts`，永不进入默认 test/check。`pnpm ittest` 先按完整后缀排除所有 `.token.ittest.ts`，再加载模块；目录和测试标题不承担费用安全语义。当前没有 token runner，不造空通过结果。

## V0 覆盖矩阵

| 文件 | 验证对象 |
|---|---|
| profile.test.ts | 默认 off、全键精确匹配、覆盖/撤回、原子数据校验 |
| policy.test.ts | 动作矩阵、defer/drop、完整 fence、A→B→A、close、自激 |
| input.test.ts | 时间倒退/非法计数、访问器/未知字段/长度、键碰撞、快照隔离 |
| delivery.test.ts | 同锚点竞争、prepare 全门槛、预算/cooldown/容量、版本删除/expiry、单次许可、幂等/冲突/超时/淘汰、failed/unknown |
| lifecycle.test.ts | 旧日志归因、activity 不绕 wake 冷却、完整 fence、期限收紧/MAX_SAFE、reload |
| shadow.test.ts | 独立零模拟账本、真实账本保持、模式切换不补发、负例 |
| replay.test.ts | fake clock/sink、无自动 timer、确定性回放、规则与角色来源、合法等待/机械负例 |
| package.test.ts | tarball 离线 JS+d.ts 消费、随包教程实际执行、exports 隔离、零 runtime dependencies/private |
| review-boundaries.test.ts | 最大身份转义、非枚举字段原子拒绝、数组 getter/iterator/空洞/null 边界 |

双来源 fixture 只复用角色记录/规则锚点的契约词汇，不复制消费者存储、阈值或 flow-gate，不代表下游已集成。fake sink 的 submitted 只代表模拟提交，不代表 adopted。

## 可运行教程回归

[使用教程](usage.md)配有[完整示例](examples/core-walkthrough.mjs)。包消费用例在本仓 .tmp 中离线安装真实 tarball 后，用 Node 运行包内示例，验证 shadow、旧 fence 失效、锚点版本变化、fake 提交、去重、撤回 override 和确定性回放。

示例仅使用公开 /core、/testing、内存快照、显式 fake clock 与同步 fake sink；不启动 Pi、不读取宿主凭据、不连接真实 provider。教学参数不作为生产标定，submitted 不代表 adopted。

新增教程断言先因 tarball 中没有示例而失败，再补示例通过；过程日志为 .tmp/tutorial-red.log 与 .tmp/tutorial-green.log。本项扩展既有包消费用例，不增加 core 行为或新的测试分类。

## 真实 Pi PTY 载具（独立后续切口）

已实际运行：macOS、Node 26.0.0、Pi **1.4.0**、x-agent-suite **0.6.1**，显式集成 **1/1**。默认 `pnpm ittest` 为 **0 pass / 1 skip**，不是宿主通过。依赖制品身份与 SHA256 见[载具计划](plans/2026-10-25-pi-pty-fixture.md)。

```sh
pnpm ittest
E2E_PI_PTY=1 pnpm ittest
```

前置要求：Node >=24，macOS `sandbox-exec`，PATH 中的官方 Pi 1.4.0。x-agent-suite 0.6.1 成对 tarball 是**可选依赖**（不在 devDependencies）：要跑 PTY 集成场景，先手动 `pnpm add -D file:<suite 制品目录>/x-agent-suite-0.6.1.tgz file:<suite 制品目录>/x-agent-suite-pty-driver-0.6.1.tgz`，提交前还原 package.json 与 lockfile；套件缺失时所有套件相关测试显式 skip，install/check 不受影响。缺失平台/命令/钓版本时给明确 skip 原因；开启后策略解析、网络探针、PTY、断言或清理错误必须失败，不转 skip、不回退 live。拒绝 `E2E_KEEP_SANDBOX=1`。

### 安全与观测证据

- `tests/support/pi-fixture.ts` 自持消费者 profile；`FakeProviderBackend` 只在本机绑定、无真实 provider 回退，显式 `injectServer:false`；不深导入 suite fixture，不安装 Pi 包或生产 adapter；V2 仅显式加载本仓测试 adapter。
- `tests/run-integration.ts` 为独立 worker 设置本仓 `.tmp/pi-pty/run-*` 临时根；profile 的 HOME、cwd、agentDir 和临时/缓存目录自控。最终环境完全以白名单替换，未知凭据、代理、宿主配置和继承 Node preload 均清除。
- Pi 同时使用 `--offline`、禁发现扩展/MCP/技能/模板/主题/上下文/工具、`--no-approve` 和 `--no-session`；V2 只额外加载显式测试 adapter，新配置 packages/auth/MCP 为空，并关闭 retry/cache warming/compaction。`--offline` 不等于推理网络封锁。
- `sandbox-exec` 使用 deny-network + `localhost:<本次端口>` 规则，provider URL 另严格固定 `http://127.0.0.1:<端口>/v1`。启动前普通 Node 进程在**同一策略文件**下证明目标端口可连、其他 loopback 端口和保留非 loopback 地址 `192.0.2.1` 被 EPERM/EACCES 拒绝；随后宿主沿用该策略。不是逐一探测所有公网地址或完整文件隔离证明。
- 一次 HTTP 请求中模型为 fake、正文含本次 prompt、无工具；随机响应 marker 不在请求中，却出现在真实 PTY 屏幕，排除只匹配 prompt 回显。固定假响应只证明传输，不证明智能行为。
- 测试自控 Node preload 只记录宿主 PID；close 后该 PID 以 ESRCH 确认退出，HOME/cwd 确认删除，runner finally 清理自有 run-root。没有声称任意后代进程树全部退出。

### 失败证据与修正

初始 SBPL 不接受 `remote ip` 中的 `127.0.0.1` 字面语法，按系统规则语法改为 `localhost` 后三路探针通过。Pi 1.4.0 footer 不再带旧 provider 括号，且 footer 早于版本横幅绘制；已补失败回归，就绪改为同时等待版本横幅与当前 footer，而不是放宽到任意 prompt 回显。

过程证据：`.tmp/pi-fixture-red.log`、`.tmp/pi-network-red.log`、`.tmp/pi-network-policy-red.log`、`.tmp/pi-pty-root-red.log`、`.tmp/pi-footer-red.log`、`.tmp/pi-ready-order-red.log`；通过证据 `.tmp/check-with-pty.log`、`.tmp/pi-pty-green.log` 和 `.tmp/pi-pty-evidence.json`。`.tmp` 是本地非版本化证据，后续运行会更新最新结果。

载具没有加载 recall 或实现同步 sink；request-local reanchor、agent_end/settled、迟到回调与组合根仍属于下述完整 V2，不能因本次通过就勾选。

## Pi V2 测试 adapter 证据（2026-10-26）

`src/pi` 已实现测试先行的同步 adapter，并经 `/pi` 加入 package exports（阶段一，2026-10-26）。会话面（阶段二）落地 `recall` 信号工具与 `/recall` 只读命令；阶段三落地有界 `configure` 与 config-hint 感知召回（随包 `recall-config` skill）。当前 `pnpm check` 实测 **85/85**，typecheck 与 build 通过；默认 `pnpm ittest` 为 **0 pass / 2 skip**，显式 `E2E_PI_PTY=1 pnpm ittest` 为 **2/2**（载具 + 10 场景矩阵）。

`tests/integration/pi-recall.ittest.ts` 的场景组实际覆盖 10 个场景：reanchor 请求局部性、版本变化、prepare 前 activity 注入失效、单次 wake 与 customType 自激抑制、已有 continuation、off、缺锚点、sink failed 不重试、recall 工具调用端到端、config-hint-configure 闭环。每场景核对随机 marker、精确请求数、fake backend 原始请求及无正文 trace；`tests/support/pi-recall-extension.ts` 只由 `-ne -e` 显式加载。阶段三新知：假端点脚本索引 = 请求体内 tool result 轮数（非请求数），`whenText` 内容路由优先于索引；fixture 新增 `dedupeMs` 旋钮以在真实 PTY 中制造 duplicate 抑制。

真实宿主纠正了两项设计/测试假设：`canContinue` 是追加草稿前的上下文状态，最终 assistant 时 false 仍可随 custom message 请求 continuation；external continuation fixture 也必须附可运行消息，不能只返回 `continue:true`。reanchor 非持久场景让锚点只供第一次评估，避免把第二次合法注入误判为旧内容残留。

过程日志位于 `.tmp/pi-v2-integration/`，逐场景请求/trace 位于 `.tmp/pi-recall-*.json`。fresh reviewer 发现的历史 wake 误判已补单元与第三次外部请求回归；shutdown/start 新 incarnation 亦有单元回归。reload/session 迟到回调仍没有独立真实 PTY 场景；真实双消费者、生产 AnchorProvider 与模型收益仍未验证。阶段一补充：`/pi` 出口经 tarball 离线消费与 d.ts 类型检查验证；adapter 增量单测覆盖去重、默认 off、事件对象去重与 reload fail-closed 防护。阶段二补充：真实宿主纠正两处——`--no-tools` 会连扩展工具一并禁用（工具场景改 `--no-builtin-tools`）；sink/接缝内嵌套推进时钟会使 commit 倒退（commit 调用点钳制到实例最新时刻），并修复测试接缝 Date.now() 注入的 1ms 窗口竟态。recall 工具端到端场景证实：假端点脚本化 toolCall → adapter 执行 acknowledge → 回执随第二轮请求回端点，trace 带 fence 与锚点版本归因。

## 独立审查与修复

只读 reviewer 审查当前完整工作树（仓库尚无 commit，不使用空 git diff），初次独立跑纯内存 39 项及 typecheck 通过；包测试由 owner 独立执行，未冒充 reviewer 证据。

发现的三项 Important（无 Critical/新增 Minor）均已补失败测试并修复：非枚举字段被 JSON 复制丢失；数组 accessor/自有 iterator 绕过纯数据边界；合法长身份转义生成超过 id 校验上限的预留。修复后的 owner 全量 44/44 + check 通过，prepare 非枚举输入另以状态不变探针核对。

证据更正：reviewer 对旧代码自定义 iterator 129 元素绕限额和 replay getter 执行次数属于静态推断，并未完成旧版本运行；其并发追加探针实际已被新校验拒绝。本文不把推断写成已实测。owner 的数组 getter/iterator 回归有独立 RED→GREEN 日志。

未由 reviewer 独立判定的项：打包安装、TDD 历史回滚、真实宿主/组合根外部保证、模型效果、恶意 Proxy/全局原型沙箱。前两项由 owner 留有测试与过程证据；后三项继续作为明确边界，不能用本轮代码评审替代。

Task8 定点只读复核为 **Critical 0 / Important 0 / Minor 0**。reviewer 独立核对已安装双包版本、tarball SHA512 与 lock SRI、当时已有请求/屏幕证据、记录 PID 的 ESRCH 与 cwd 不存在，并运行 typecheck 和不写文件的纯断言；16 个 src 文件 hash 与阶段零一致。真实 PTY、OS 探针、新增会写 .tmp 的单测、安装/build 与历史 RED 仍为 owner 执行证据，不冒充第二人动态宿主复现。

## 后续 V1–V4

1. **V1 真双消费者 shadow**：固定 core 版本和基线，机械/合法等待/无协作负例；人工或既有 verifier 标签、deadline 和 unknown；fixture 不代替真实接入。
2. **V2 钉版本真 Pi + sandbox + 假端点，零 token**：测试 adapter 已完成 8 个场景，覆盖 request-local reanchor、continuation、settled wake 与提交前 activity；reload/session 迟到回调的真实 PTY 场景仍待补。源仓 Pi 0.84.1 与当前全局 1.4.0 不可混证。
3. **V3 真不加载库的基线**，不仅 mode=off；旧 Wake/nudge 单独固定。主指标为正确采用/任务结果；反指标包括误派工、重复广播、翻对为错、正确停止、token/extraRun/latency/cache。仅显式 token 车道，当前未授权/未运行。
4. **V4 删除实验**：升级先测无库/原生基线；原生不劣关 profile，仅 reanchor 有净收益则删 wake。是否删除 core 看净收益和共享复杂度是否重新散落，不按宿主数量机械裁决。

## 剩余验证边界

已运行真实宿主载具 smoke 和测试 adapter V2 场景，但未运行生产 recall canary、真实双消费者 shadow、付费模型 A/B、论文复现或发布。incarnation 唯一、事实真实性、正文实际 bytes 和 prepare→sink 原子性由宿主组合根负责；受控 fixture 不证明生产 AnchorProvider、多消费者或模型收益。

阈值与权重未标定前不进入默认 emit。论文排行榜是候选证据，不是本地收益证明；行业分数缺测必须保留为缺测。
