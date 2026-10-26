# Pi V2 宿主集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不公开 `/pi` 的前提下，实现测试先行的真实 Pi recall adapter，并以零 token 真实 PTY 验证 reanchor、wake、continuation 和生命周期失效。

**Architecture:** `src/core` 保持不变；`src/pi` 用结构化宿主类型和同步 AnchorProvider 组合公开 core。reanchor 经 `context` 返回请求级 custom message，wake 经 `agent_before_settle` 返回 custom_message entry 与 `continue:true`；真实 PTY 复用现有 sandbox/fake backend。

**Tech Stack:** TypeScript 6、Node >=24（开发测试）、Pi 1.4.0、x-agent-suite 0.6.1、node:test、pnpm。

**Spec:** `docs/spec/2026-10-26-pi-v2-integration-design.md`

**执行状态：** Task 1–4 已完成；`pnpm check` 65/65，真实 PTY 2/2、recall 8 场景。fresh review 的 wake 历史误判已修复。范围偏差：adapter 同步 sink 的显式 `unknown` 选择延期；reload/session 迟到回调仅有单元失活验证，二者均未形成真实 PTY 场景，不能视为原 V2 矩阵全部完成。

## Global Constraints

- 只写本仓；不修改相邻仓，不新增 runtime dependencies，不公开 `/pi`，不提交或发布。
- 新行为先 RED 后 GREEN；core 只收无正文元数据，prepare 与本地 sink 草稿构造之间不 `await`。
- 测试 adapter 仅由显式 `-ne -e <path>` 加载；真实宿主测试只在 `E2E_PI_PTY=1 pnpm ittest` 运行，零真实 token。
- 单文件不超过 500 行，函数尽量不超过 50 行；导出符号使用中文 JSDoc。
- 过程记录写 `.tmp/pi-v2-integration/progress.md`；每个任务完成后记录实际命令和结果，不执行 commit 步骤。
- submitted 只表示本地同步 sink 草稿完成，不等于 Pi 接受、provider 收到或模型采用。

## Review Focus

- 多字节正文与版本/expiry 同时变化：Task 1 断言 UTF-8 字节数和重新读取后的 metadata，不允许旧正文。
- 重复外部通知与 recall 自激：Task 2 断言同一事件只推进一次、attention run 不重开预算。
- 已有 continuation 和 aborted/error：Task 2/3 均断言不 wake，避免只测 happy path。
- 宿主实际事件载荷/返回组合与结构类型不一致：Task 3 必须用真实 Pi 请求证明，不以 fake API 替代。
- 扩展加载失败、证据缺失和清理失败：Task 3 断言失败而非 skip 或假通过。

---

### Task 1: 同步锚点与投递内核

**Files:**
- Create: `src/pi/host-types.ts`
- Create: `src/pi/anchor.ts`
- Create: `src/pi/recall-runtime.ts`
- Test: `tests/unit/pi-anchor.test.ts`
- Test: `tests/unit/pi-recall-runtime.test.ts`

**Interfaces:**
- Consumes: `/core` 的 `PolicyCore`、`AttentionConfig`、`AnchorMetadata` 和公共投递契约。
- Produces: `PiAnchorProvider.current(): PiAnchorSnapshot | undefined`；`createRecallRuntime(options: RecallRuntimeOptions): RecallRuntime`。
- `RecallRuntime` 提供 `beginRun(provenance, now)`、`reanchor(messages, now)`、`wake(boundary, now)`、`transition(event)`、`close()`；返回结构只含 Pi 草稿与 core 结果，不执行 I/O。

- [ ] **Step 1: 写快照和 UTF-8 失败测试**
  断言缺失快照返回 undefined；`"锚"` 的 sizeBytes 为 3；版本、expiresAt 和正文来自同一次 current() 读取；修改外部快照不污染已返回 metadata。
- [ ] **Step 2: 运行 RED**
  Run: `pnpm exec tsx --test tests/unit/pi-anchor.test.ts`
  Expected: 因 `src/pi/anchor.ts` 不存在而失败。
- [ ] **Step 3: 实现最小 host-types/anchor**
  `PiAnchorSnapshot` 含 `ref/version/content/expiresAt?`；`PiAnchorProvider.current()` 同步返回完整快照；`readAnchor(provider)` 返回隔离的 snapshot + metadata，正文不传给 core。
- [ ] **Step 4: 写 reanchor/wake 失败测试**
  用真实 `createPolicyCore` 验证：reanchor 只返回一条 `role:"custom"`、`customType:"pi-agent-recall.reanchor.v1"` 的请求级消息；wake 只在 completed、continue=false、pending=0 时返回 `custom_message + continue:true`；版本变化、缺锚点、continuation、attention 来源均沉默；prepare 后 sink 抛错记 failed 且不自动重试。
- [ ] **Step 5: 运行 RED**
  Run: `pnpm exec tsx --test tests/unit/pi-recall-runtime.test.ts`
  Expected: 因 `createRecallRuntime` 不存在而失败。
- [ ] **Step 6: 实现同步 RecallRuntime**
  reanchor 在 beginRun 捕获候选并 evaluate、在 reanchor 重读快照后 prepare；wake 在边界内 evaluate/prepare。提交和 commit 同步完成，不写 session、不调用 sendUserMessage。
- [ ] **Step 7: 运行 GREEN 和全量单测**
  Run: `pnpm exec tsx --test tests/unit/pi-anchor.test.ts tests/unit/pi-recall-runtime.test.ts && pnpm test`
  Expected: 新测试及既有测试全部通过。

### Task 2: Pi 事件组合根与生命周期

**Files:**
- Create: `src/pi/extension.ts`
- Test: `tests/unit/pi-extension.test.ts`
- Test: `tests/support/pi-extension-fixture.ts`

**Interfaces:**
- Consumes: Task 1 的 `RecallRuntime`、`PiAnchorProvider` 和结构化 Pi 事件类型。
- Produces: `createPiRecallExtension(options: PiRecallExtensionOptions): (pi: PiExtensionApi) => void`；测试可注入 `now()` 与无正文 `trace()`。

- [ ] **Step 1: 写事件映射失败测试**
  通过真实 extension factory 注册 fake API，驱动 `before_agent_start → context` 和 `agent_before_settle`；断言用户 run 可 reanchor，recall custom run 为 attention；`agent_start/turn_start` 不推进 epoch，重复通知不重复推进；session/reload close 后旧回调无效。
- [ ] **Step 2: 运行 RED**
  Run: `pnpm exec tsx --test tests/unit/pi-extension.test.ts`
  Expected: 因 `src/pi/extension.ts` 不存在而失败。
- [ ] **Step 3: 实现最小事件组合根**
  注册 `before_agent_start/context/agent_before_settle`、明确的 external activity 与 shutdown；每次 runtime 使用唯一 incarnation，旧 runtime 先 close。异常记录无正文 trace 并 fail closed，不阻断原始用户请求。
- [ ] **Step 4: 运行 GREEN、类型检查和全量单测**
  Run: `pnpm exec tsx --test tests/unit/pi-extension.test.ts && pnpm typecheck && pnpm test`
  Expected: 全部通过，无新增运行时依赖或 `/pi` export。

### Task 3: 真实 Pi V2 集成场景

**Files:**
- Create: `tests/support/pi-recall-fixture.ts`
- Create: `tests/support/pi-recall-extension.ts`
- Create: `tests/integration/pi-recall.ittest.ts`
- Modify: `tests/support/pi-fixture.ts`（仅允许显式扩展路径和场景环境）
- Test: `tests/unit/pi-fixture.test.ts`

**Interfaces:**
- Consumes: Task 2 extension factory、现有 `createPiFixtureProfile`、sandbox 和 `FakeProviderBackend`。
- Produces: 测试专用 fixture entry、场景配置和无正文 trace/evidence；不进入 `src/pi` 生产候选配置。

- [ ] **Step 1: 为显式扩展门禁写失败单元测试**
  断言 `-ne` 与唯一 `-e <测试 entry>` 同时存在，其他扩展仍禁用；非法/缺失场景配置失败，不能回退 live。
- [ ] **Step 2: 运行 RED 并实现最小 fixture 扩展**
  Run: `pnpm exec tsx --test tests/unit/pi-fixture.test.ts`
  Expected: 新显式扩展断言失败；实现后该文件恢复全绿。
- [ ] **Step 3: 先写真实 Pi 集成失败场景**
  覆盖 spec 表格：加载身份、reanchor 正向/非持久、版本变化、注入失效、wake 正向、已有 continuation、自激、off/缺锚点/未知事实、failed/unknown、reload/session 迟到回调及清理。每场景断言精确请求数、随机 marker、原始请求和无正文 trace。
- [ ] **Step 4: 运行真实 RED**
  Run: `E2E_PI_PTY=1 pnpm ittest`
  Expected: 新 recall 场景因 adapter 尚未接入 fixture 而失败；既有 PTY 不受影响。
- [ ] **Step 5: 实现最小测试 entry 和场景驱动**
  测试 entry 使用确定性 AnchorProvider 与固定 config；故障注入只在 tests/support。扩展未加载、证据缺失、请求数不符或清理失败必须 throw。
- [ ] **Step 6: 运行真实 GREEN 与默认门禁**
  Run: `E2E_PI_PTY=1 pnpm ittest && pnpm ittest && pnpm check`
  Expected: 显式集成全部通过；默认集成仅明确 skip；默认单测/typecheck/build 全绿。

### Task 4: 文档、证据复核与最终审查

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/README.md`
- Modify: `docs/architecture/decision-flow.md`
- Modify: `docs/package-boundary.md`
- Modify: `docs/testing.md`
- Modify: `docs/spec/2026-10-26-pi-v2-integration-design.md`
- Modify: `docs/plans/2026-10-26-pi-v2-integration.md`

- [ ] **Step 1: 更新实现状态和证据边界**
  标明测试 adapter 已实现但 `/pi` 未公开；记录实际事件语义、fault-injection、runner 实测数量和日志位置，不保留“接口未实施”的过期描述。
- [ ] **Step 2: 运行最终验证**
  Run: `pnpm check && pnpm ittest && E2E_PI_PTY=1 pnpm ittest && git diff --check HEAD`
  Expected: 全部退出码 0；默认 skip 与显式通过分开报告。
- [ ] **Step 3: 独立最终 Code Review**
  使用 fresh reviewer 审查 HEAD 到当前完整工作树、spec/plan 和 Review Focus；Critical/Important 以 RED→GREEN 做一轮修复，Minor 记录延期，不盲目接受误报。
- [ ] **Step 4: 完成 ledger 与交付报告**
  列出修改、双方验证、未验证生产/模型边界、rulings、deferred minors 和注释收口范围；不提交、不发布。
