---
type: map
---
# 文档地图

## 持续维护文档（living）

- [架构总览](architecture/README.md)：定位、模块、边界与实现/设计状态，是架构主入口。
- [策略与配置](architecture/policy-and-configuration.md)：实际策略支持矩阵、Policy/Config/Profile 关系和覆盖权限。
- [决策链路](architecture/decision-flow.md)：当前与目标的提案、预留、复核、投递和回执。
- [执行内核](architecture/core.md)：当前状态、生命周期、账本与执行不变量。
- [使用教程](usage.md)：从构建、配置、shadow 到 fake 投递、生命周期、回放和排错。
- [可运行教程示例](examples/core-walkthrough.mjs)：零 token，按当前公开接口执行断言，并经 tarball 离线消费验证。
- [包与消费者边界](package-boundary.md)
- [测试与实验门禁](testing.md)

## Dated 设计与施工档案

- [原 Attention Policy 设计快照](spec/2026-10-24-agent-attention-policy-design.md)：复制自 内部事件总线，原仓未改；历史“待评审”不撤销后续限定范围实施授权。
- [阶段零切口](spec/2026-10-25-phase-zero.md)：包括最初命名取舍，旧名称仅为历史记录。
- [最终命名与 runtime 契约补充](spec/2026-10-25-runtime-contract.md)：最终名 pi-agent-recall，冲突处优先。
- [确定性策略核心补全设计](spec/2026-10-25-deterministic-policy-core-design.md)：已确认先补核心闭环；书面设计待评审，接口未实施，不能当作当前能力。
- [Pi V2 宿主集成设计](spec/2026-10-26-pi-v2-integration-design.md)：adapter 已实施、有真实 PTY 证据并经 `/pi` 公开；生产 AnchorProvider 未做。
- [会话面设计](spec/2026-10-26-config-layer-design.md)：三维切分——模型仅 1 个 `recall` 工具（acknowledge/refresh 信号），人用 `/recall` 命令机械只读查看，触发链路与 TUI 线框图固化；CLI 与落盘配置端已冻结。待书面评审，未实施，批准即解除旧规格的工具暂停条款。
- [施工计划](plans/2026-10-25-phase-zero.md)：记录步骤与完成状态，不替代当前架构。
- [真实 Pi PTY 载具计划与结果](plans/2026-10-25-pi-pty-fixture.md)：独立零费用真实 TUI 验证，不冒充完整 V2。
- [Pi V2 实施计划](plans/2026-10-26-pi-v2-integration.md)：测试 adapter 的 TDD 施工与验证记录。
- [阶段一 adapter 公开计划](plans/2026-10-26-phase-one-adapter.md)：`/pi` 出口、评审修正与基线合并记录。

## 研究

- [模型注意力干预研究快照](research/agent-im/2026-10-24-model-attention-interventions.md)：保留历史时点；原数值口径的纠偏见下述新报告。
- [业界注意力评分与离线标定报告](research/2026-10-25-attention-scores-and-offline-calibration.md)：一手证据矩阵、版本/分母/许可、多维画像、更新规程与候选映射；不是本地净收益证明。
- [业界评分调研任务档案](research/2026-10-25-attention-evaluation-agenda.md)：范围已交付，议程本身不作为证据。

## 维护规则

架构按视角持续维护，并显式区分已实现、已确认方向、待评审和未验证；策略与配置的整体关系不能只存在于 dated spec。使用/测试事实原地更新；spec 保留某次变更的契约、取舍与验收，历史正文不伪装成最新实现。文档有 type；dated spec/plan 有 date/status，dated research 有 date。禁止 docs/superpowers 层级。

本次迁移为复制，内部事件总线 原文件、索引与既有未提交修改全部保留。暂停的旧 旧内部方案 方案不复制为实施依据；内部知识库 本地链接只是外部可选来源，未复制其业务存储或状态。
