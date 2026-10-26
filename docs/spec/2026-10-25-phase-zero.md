---
type: spec
date: 2026-10-25
status: 实施依据
---
# 阶段零：独立注意力策略核心

## 目的与授权

交付可独立安装、零宿主依赖、可确定性回放的 TypeScript `core/testing`，只决定何时沉默、为下一请求重锚定、或建议停后一次推理。投递不是采用，更不是完成任务。

来源是 内部事件总线 的 `docs/spec/2026-10-24-agent-attention-policy-design.md` 与 `docs/research/agent-im/2026-10-24-model-attention-interventions.md`。本次交接明确授权新独立 repo 的第一阶段实现；旧 spec 的待评审状态不在源仓改写。本阶段不接 Pi、不修改两消费者、不生产 emit。后续 adapter/迁移另行评审。

## 命名与模板取舍

- 选定 repo、sibling 目录、npm 名称 `agent-attention-policy`。attention-policy 表明这是模型注意力决策；reanchor 是优先动作，不把 wake 当成整个产品。
- 备选 `model-reanchor` 过窄，`agent-attention-core` 不适合后续 adapter。
- 2026-10-25 创建前检查 sibling 不存在、三个候选的 npm registry 均返回 404。查询不保留名称，也不是发布授权。
- 抽样 内部事件总线 与 pi-rpc：沿用 AGENTS/AGENTS.ai、pnpm 10.33.0、ESM/strict TS、kebab-case 文件、中文 JSDoc、单元/集成/token 分层及 docs 的 living/dated 分离。
- 独立库用 NodeNext 生成 dist JS+d.ts；不复制 Pi peer、事件总线/RPC、绝对路径、个人配置或宿主 skill。`private:true` 防误发布，版本 `0.1.0-experimental.0`。
- 当前环境没有 PowerShell 7，本仓允许 Bash 等价执行；这不修改源仓规则。

## 最小接口补充

1. `AnchorRef = { provider, id }`。消费者的 provider namespace 避免不同来源键碰撞。AnchorSnapshot 含正文；core 的输入、状态和日志只含 AnchorMetadata（ref/version/expiresAt/sizeBytes）。
2. `evaluate({ candidate, anchor?, now })` 只接显式时间和规范化事实。事实为请求机会、活动、continuation、确定性 evidenceCount 与宿主能力；未知不是 false，不接受语义猜测或任意正文 facts。
3. core 分配 revision/generation/epoch：配置成功更新 revision；session/reload 转换增加 generation，即便 A→B→A；真实外部 activity 转换增加 epoch。候选、预留和回执捕获完整 fence。
4. emit 决策只产生有界 reservation；`prepareDelivery` 使用当前元数据、当前事实、显式 now 复核 fence/version/expiry/能力/活动，不允许旧 v1 决策偷偷换 v2 内容。失败后需重新 evaluate。
5. prepare 成功即计一次尝试预算、冷却和去重；宿主明确失败或 unknown 也不退还，避免重试放大。`commitDelivery` 只接受 submitted/failed/unknown；重复回执幂等，冲突回执显式报错，迟到旧回执无效。不会自动重试，也不承诺 exactly-once。
6. 同 ref@version 的并发候选被预留阻挡。所有保留项有 deadline；无机会且有明确 deadline 可返回 defer，但 core 不保存补发队列，调用方须重新 evaluate。无 deadline 或不可恢复条件为 drop。
7. 一个 core 只服务一个显式 owner 的 session。core 不持有 sink、不自动发现 owner、不跨进程仲裁。未来接入必须将存量 事件总线 Wake 与 内部知识库 staleness/nudge 纳入同一组合根控制。

## 动作与 profile

- 默认 off/silent。实际下一请求存在时，仅可 reanchor；能力不支持或动作关闭时保持 silent，不偷换成 wake。
- wake 只在 settled、无下一请求、明确无 continuation、有效锚点、确定性线索及预算均满足时建议。attention provenance 默认 drop，真实外部 epoch 才重开阶段预算。
- profile 完整匹配 host/hostVersion/provider/model/modelRevision/taskFamily/roleTopology/policyVersion/reminderTextVersion。未知组合使用 conservative off；用户显式 override 可覆盖并可撤回，不猜模型强弱。
- 配置整体校验后原子替换；失败不改变 revision、runtime 或预留。成功配置变化取消旧预留，但不清真实尝试预算、去重与 cooldown；切模型本身不产生决策。
- shadow 返回 silent + wouldAction，使用独立模拟账本，不产生票据或 submitted/adopted。shadow→emit 丢弃模拟账本和历史候选，不补发。
- 同 session 的 activity 只重置阶段计数，不重置 cooldown/去重；新 session incarnation 清空本地状态，不承诺跨 resume 恢复。

## 有界性与观测

配置限制 pending、日志、活跃去重条目、正文 bytes、reservation TTL、wake TTL/频率/次数。时间必须为安全、非负、有限整数；时钟不能倒退。有效去重表满时拒绝新预留，而不是驱逐仍有效条目。

日志仅记录归一事实、引用、版本、上下文、动作/抑制原因、投递结果。无正文、prompt/transcript；缺失效果与成本保持 unobserved，不从提交推断采用。调用方另以独立证据评估 adoption/falseAction。

## 阶段边界与验证

- 本轮：V0 核心契约、双来源 contract fixture、fake clock/sink、replay、打包消费验证。
- fixture 来源：事件总线 当前角色记录/最终角色门槛；内部知识库 的 readanchor/staleness 概念及公开注入契约在来源研究中的映射。它们是 contract fixture，不是两仓已接入，不复制存量阈值、持久 pending、fallback 或 flow-gate。
- 后续：V1 真实双消费者 shadow；V2 钉版本真 Pi + sandbox + 假端点；V3 显式 token A/B；V4 删除实验。
- 绝不增加 judge、daemon、memory bank、业务 scheduler、registry、离线队列、hardGate 或持久补发。
