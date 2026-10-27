---
type: plan
status: completed
---
# 阶段一：`/pi` adapter 公开与基线合并（2026-10-26）

## 目标

把阶段零已实施但未公开的 `src/pi` adapter 变为公开入口，并在此过程中完成评审修正、增量测试与基线合并。

## 背景

- 阶段零收口时 `src/pi` 代码、`tests/support/pi-recall-extension.ts` 与 8 场景 PTY 矩阵由并行会话完成，但代码文件未随阶段零提交入库，形成「测试在库、实现游离」的倒挂。
- 阶段零提交栈落地于 `feat/phase0-core` 并以 `b2bb893` 建立 `main` 基线；草稿先存于 `feat/phase0-core` 的 `56803fd`。

## 步骤与结果

1. **评审草稿**：对照本机 Pi 1.4.0 `dist/core/extensions/types.d.ts` 逐字段核对 11 个事件与载荷形状，全部吻合。发现一项缺陷：`reload` 未走 `guard()` 且 ignored 时伪装 applied。
2. **分支**：`feat/phase1-pi-adapter` 自 `main` 拉出，cherry-pick 草稿（`26fce65`）。
3. **失败测试先行**：`tests/unit/pi-adapter.test.ts` + 包契约 `/pi` 翻转，RED 2 项（`1ed7e40`，证据 `.tmp/pi-adapter-red.log`）。
4. **实现修正**：reload 走 fail-closed 防护并如实归因；新增 `src/pi/index.ts` 与 `./pi` exports（`a52aaa3`），GREEN 76/76。
5. **去重**：发现 `9f3bf1a` 已含 15 例 adapter 单测与 8 场景矩阵，精简增量测试至 4 项缝隙用例（`b6d7b9e`），69/69。
6. **PTY 复验**：`E2E_PI_PTY=1 pnpm ittest` 2/2（载具 + 8 场景矩阵），真实 Pi 加载真实 `createPiRecallExtension`，零 token。
7. **文档同步**：README、AGENTS、package-boundary、usage、architecture、testing 中的「未公开 /pi」陈述全部更新；版本升至 `0.2.0-experimental.0`。
8. **合并**：`feat/phase1-pi-adapter` 以 `--no-ff` 合回 `main`。

## 不做的事（YAGNI）

- 不重复建设 PTY 矩阵：已有 8 场景覆盖，自建重复文件已删除。
- 不改写阶段零历史：混合时点瑕疵在汇报中披露，不 rebase。
- 生产 AnchorProvider、双消费者迁移、`*.token.ittest.ts` 模型实验：仓外职责或需显式授权/付费，不在本阶段。

## 剩余风险

- reload/session 迟到回调无独立真实 PTY 场景（沿用阶段零结论）。
- 多会话并行写同一仓导致的提交时点倒挂，已在阶段零 C4 中发生一次；后续阶段需在开工前确认工作区无他人未跟踪文件。
