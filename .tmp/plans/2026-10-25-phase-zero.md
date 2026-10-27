---
type: plan
date: 2026-10-25
status: 阶段零已完成
---
# 独立注意力策略核心实施计划

> **For agentic workers:** 使用 executing-plans 逐项执行；recall-owner 唯一写入，recall-reviewer 只读审查（替代已退出的旧 attention 两会话）。无 commit/push 权限，因此以测试证据和 `.tmp/progress.md` 留痕，不调用依赖已有提交的辅助脚本。

**Goal:** 建立 `pi-agent-recall/core` 和 `/testing` 的最小可运行纯库。

**Architecture:** core 接规范化事实和锚点元数据，持有会话局部 fence、预留和账本。消费者拥有正文，宿主拥有投递；testing 以 fake 和 replay 验证同一公共接口。

**Tech Stack:** TypeScript/ESM/NodeNext、Node >=22、pnpm 10.33.0、node:test + tsx；零 runtime dependencies。

**Spec:** [阶段零设计](../spec/2026-10-25-phase-zero.md)及[最终命名与 runtime 契约补充](../spec/2026-10-25-runtime-contract.md)；补充在冲突处优先。

## Global Constraints

- 只写本仓；内部事件总线/内部知识库 等 sibling 只读；无 commit/push/publish。
- 单个文件不超过 500 行；导出符号中文 JSDoc，跨边界入口注释不变量。
- core 无 Pi/消费者/Node I/O，无正文状态；不实现真实 adapter。
- 默认 silent/off；shadow 不污染 emit；submitted 不代表 adopted。
- 所有代码行为先 RED 后 GREEN；默认测试零 token；不机械复制源仓集成 runner。

## Review Focus

- v1 决策后 v2/删除/过期：prepare 必须拒绝；由任务 2 的 metadata 复核测试覆盖。
- 并发同锚点、全部预算/冷却复核、单次 permit、unknown、重复/冲突回执及回执淘汰：只记一次尝试，绝不自动重试；任务 2 覆盖。
- 跨实例 incarnation、close、A→B→A、带 fence/provenance 的活动转换、模型/配置更新：旧候选和旧回执无效且配置不绕预算；任务 2 覆盖。
- shadow→emit、从零模拟账本语义、能力不支持、未知 continuation：不偷换动作或补发；任务 1/2/3 覆盖。
- 不可信对象/NaN/Infinity/负数、时钟倒退、容量与字符串上限、分隔符碰撞：明确错误或 fail-closed；任务 1/2 覆盖。

## 文件分工

- `src/core/contracts.ts`：AnchorRef、候选、fence、动作与生命周期公共类型。
- `src/core/profile.ts` / `validation.ts`：精确 profile、默认值、无副作用校验。
- `src/core/policy-core.ts` / `decision.ts` / `ledger.ts`：会话状态、动作选择、有界记账与投递前复核。
- `src/core/index.ts`：公共入口。
- `src/testing/{clock,sink,replay,index}.ts`：fake clock/sink 与纯 replay，不含宿主。
- `tests/unit/{profile,policy,delivery,replay,package}.test.ts`：公共契约测试。
- `tests/support/fixtures.ts`：两类来源样例与可控配置。
- `docs/architecture/core.md`、`docs/{usage,testing,package-boundary}.md`：当前事实与未来门禁。

## Task 1：配置与公共契约

**Produces:** `resolveProfile(config)`、配置与候选/动作公共类型 exports；factory 与生命周期在 Task 2 实现。

- [x] 建立 package/TS/test 配置和测试导入占位（只占位，不预写行为）。
- [x] 写 profile 测试：默认 off；全键精确匹配；未知模型回退；用户覆盖/撤回；NaN/负数/未知字段显式拒绝。
- [x] 运行 `pnpm test`，确认缺失行为造成断言失败。
- [x] 实现最小配置解析与公共类型，运行 `pnpm test && pnpm typecheck` 为绿。

## Task 2：纯决策与投递记账

**Consumes:** Task 1 的完整 profile 与类型。
**Produces:** `createPolicyCore({ scope, owner, incarnation, config? })`、`evaluate(input)`、`prepareDelivery(id, input)`、`commitDelivery(permit, result, now)`、`applyConfig(config)`、`transition(event)`、`close()`、`getState()`。

- [x] RED/GREEN 动作矩阵：silent 默认、reanchor 优先、settled/no continuation 才 wake、unknown/不支持能力保持沉默。
- [x] RED/GREEN fence：跨实例 incarnation、close、旧 revision/generation/epoch、A→B→A、transition 的 captured fence/provenance、自激与真实外部 epoch 交错；配置原子替换与预算保留。
- [x] RED/GREEN reservation：同 ref@version 并发、deadline/defer/drop、预算/冷却/去重、容量上限与时钟非法输入。
- [x] RED/GREEN prepare/commit：完整门槛重新检查、一次性许可且紧邻同步 sink；版本更新/删除/过期拒绝；重复回执幂等、冲突显式错误；failed/unknown 不退款；有界回执保留，迟到或淘汰回执明确 stale。
- [x] 每组运行完整 `pnpm test`；任务结束 `pnpm typecheck`。

## Task 3：testing 与 replay

**Consumes:** Task 2 公共接口。
**Produces:** `createFakeClock`、`createFakeSink`、`replay`，以及两类来源 contract fixtures。

- [x] RED/GREEN shadow 会计算 wouldAction/模拟预算，但没有 sink 调用或真实提交；切 emit 不补发。
- [x] RED/GREEN replay 相同输入有相同输出；fixture 的合法等待/机械负例保持沉默，规则与角色共用同一个 core。
- [x] RED/GREEN fake sink 可控制 submitted/failed/unknown，不虚构 adopted；fake clock 显式推进且拒绝倒退。
- [x] 运行 `pnpm test && pnpm typecheck`。

## Task 4：交付验证与审查

- [x] 写 README、架构/使用/验证/包边界文档，明确 0.x experimental 与未实接宿主。
- [x] `pnpm check` 覆盖 test/typecheck/build；打包 tarball 后离线本地安装并运行 `/core` 与 `/testing` 消费，拒绝私有深层导入。
- [x] 检查无 core 外部导入、无 >500 行源文件、无硬编码本机路径与未注释导出。
- [x] 现有 reviewer 只读审查；三项 Important 补失败测试后修复，全量 44/44 + typecheck/build 通过。
- [x] 核对无远程/commit及源仓现状；迁移前后初始快照比对由旧 owner 已实证交接，本会话仅独立核当前状态/hash，不冒充重新取得初始快照。

## 收口与新授权

阶段零仅交付 core/testing，未做真实模型或生产迁移。研究报告是独立交付，不以本计划勾选代替。用户后续授权在两项收口后复用 x-agent-suite 做真实 Pi PTY + sandbox + 假端点零 token 验证，属于后续独立测试切口，不回写为本阶段已完成的宿主 canary。
