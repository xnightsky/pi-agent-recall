---
type: architecture
---
# 执行内核：状态、生命周期与投递约束

## 职责与阅读入口

本页描述当前已实现的执行机制，不再充当全部架构的入口。现有内核包含固定动作选择、fence、预算、预留与回执；这不等于完整的可定义策略核心已完成。

- 总体模块、边界与实现状态见[架构总览](README.md)。
- 策略支持矩阵、Policy/Config/Profile 关系与覆盖权限见[策略与配置](policy-and-configuration.md)。
- 当前及目标端到端链路见[决策链路](decision-flow.md)。

core 当前接受调用方已构造的候选、确定性事实与无正文元数据，持有单实例 fence、预留、账本与有界日志。不持有 AnchorProvider、sink、timer、文件、网络或全局 registry；输入时间以非负安全整数毫秒表示，不能倒退。

正文、真实事实、唯一投递 owner 与 prepare→sink 同步边界由消费者和宿主组合根负责。该外部责任不能被纯 core 测试替代。


## 模块与接口

| 模块 | 职责 |
|---|---|
| `contracts.ts`、`runtime-types.ts` | 无正文候选、fence、投递、状态、日志与生命周期公共类型 |
| `profile.ts`、`profile-types.ts` | 全键精确 profile、显式覆盖与 conservative/off |
| `validation.ts`、`input-validation.ts` | 有界纯数据与时间校验，结构化引用键、快照隔离 |
| `decision.ts`、`ledger.ts` | 动作选择及 evaluate/prepare 共享账本门槛 |
| `runtime.ts` | 会话内部状态、显式时间清理、诊断日志 |
| `delivery.ts` | 单次 prepare、保守尝试记账、幂等回执 |
| `policy-core.ts` | 工厂与生命周期组合，不调用宿主 |
| `testing/{clock,sink,replay}.ts` | 显式 fake 与同公共接口回放，无真实 provider |

公开入口 `/core` 导出 `resolveProfile`、`createPolicyCore` 及数据类型；`/testing` 导出 `createFakeClock`、`createFakeSink`、`replay` 及相应类型。私有模块不通过 package exports 暴露。

## 生命周期与唯一 owner

`createPolicyCore({ scope, owner, incarnation, config? })` 不做自动发现或全局仲裁。组合根必须保证每 runtime 的 incarnation 唯一，同 session 只有一个 emit owner，并 close 旧实例。

完整 fence 为 `scope/owner/incarnation/revision/generation/epoch`：

- 成功 applyConfig 推进 revision，清旧预留/许可/回执；非法配置整体拒绝且运行态不变。
- external activity 推进 epoch，session/reload 推进 generation（A→B→A 不复用旧代次）；这些真实转换重置阶段计数。
- transition 必须带捕获 fence 和 external 来源。旧 callback、attention 自激来源不能重开预算。
- 同实例配置/模式变化保留真实次数、cooldown、去重；真实 activity/session/reload 只重置阶段次数，不清 cooldown/去重。
- 新 incarnation 新实例从零开始，不承诺跨 resume 恢复。close 后 evaluate/prepare 沉默或拒绝，commit stale，applyConfig 报错；getState 仍可诊断。

## 动作、预留和投递

默认 off。机会明确存在时只可 reanchor；能力缺失或关闭不会升级成 wake。wake 必须 settled、明确无下一请求和 continuation、有有效锚点与足够确定性证据，且通过全部预算/频控。

evaluate 只生成预留，不记尝试。相同 ref@version 并发预留被阻挡；无机会且有未到期 deadline 可返回 defer，但 core 不保存补发队列。预留期限取 candidate deadline、anchor expiry、reservation TTL 和 wake TTL 的最小值。

组合根重新读取完整快照并计算 sizeBytes 后调用 prepare；它复核 fence、ref/version/expiry/大小、当前事实/能力、全部预算/cooldown/去重容量。版本改变、删除或动作改变均拒绝，不偷偷换正文或改动作。有效 prepare 消耗预留并至多返回一次许可，立即保守记一次尝试。许可不得 await、缓存或跨状态转换。

commit 只接受 submitted/failed/unknown。failed/unknown 不退款、不重试；相同结果在保留窗口内幂等，冲突显式报错。未回执项超时或 lifecycle 失活记录 unknown，之后回执 stale；已淘汰 id 不重建票据。

## 有界性与观测

- `maxPending` 共同限制预留与待回执；`maxLogEntries` 限制日志与完成回执数量。
- 待回执 deadline 和已完成回执保留时长均复用 `reservationTtlMs`；不把 TTL 当自动 timer。
- `maxDedupeEntries` 满时拒绝新动作，不淘汰仍有效记录。配置缩容不抹掉旧去重；既有条目到期后自然降到新上限。
- 身份/ref/version 最多 256 字符，profile/context 最多 128 字符；键用结构化元组，不拼分隔符。正文大小是消费者可信计算的元数据，core 不可能验证未传入的正文。
- getState 返回隔离快照。日志只有归因、规范化事实、元数据、动作与结果；adoption/cost 始终 unobserved。
- shadow 日志的 `action` 为模拟动作、`reason=shadow`、没有 delivery；对外返回 silent+wouldAction。必须按这些字段共同分析，不能统计成提交。
- 清理仅在下一次携 now 的 API 调用惰性发生；getState/fake clock 推进本身不执行到期。

普通数据校验拒绝未知/非枚举字段、访问器、非法原型、枚举和数值；profiles/events 数组先按 own descriptor 校验并复制，拒绝空洞、索引 getter 和自有 iterator，不能由外部迭代器绕过容量。它不是隔离执行恶意 JavaScript/Proxy 的沙箱；宿主应传序列化规范化事实，不把未知可执行对象当受信事实。

## Shadow 与效果边界

shadow 从独立零账本开始，不是沿用当前 emit 已使用预算的精确反事实；切模式丢弃模拟账本和旧候选，真实账本保留，不补发。core/testing 验证这些契约，不证明真实 Pi 注入位置；V2 另证明受控 fixture 的请求级注入，但不证明缓存、生产接入、用户任务结果或采用收益。

接口约束见[使用指南](../usage.md)、[runtime 契约](../spec/2026-10-25-runtime-contract.md)，验证层次见[测试门禁](../testing.md)。已有 `src/pi` 测试 adapter 与同步组合根，但仅供显式测试 fixture 加载；没有公开 `/pi`、生产 adapter、业务状态机或生产迁移。

## 策略闭环的接入位置：尚未实现

目标是在同一个执行内核之前补齐策略定义、参数解析和观察到提案的生成，不新增平行投递路径。

未来内核还需将策略/规则归因绑定到预留和回执，并在 prepare 时复核原规则；这些并非当前字段或能力。具体关系由[策略与配置](policy-and-configuration.md)和[决策链路](decision-flow.md)维护。

策略切换仍须通过统一配置与生命周期失效机制，不能清空真实账本、复活旧许可，或把安全不变量改成可跳过的规则。目标接口仍待书面评审，当前未进入实现。
