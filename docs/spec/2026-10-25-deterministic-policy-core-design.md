---
type: spec
date: 2026-10-25
status: 待书面评审，未实施
---
# 确定性策略核心：定义、解析、提案与安全执行

## 1. 目的、确认范围与状态

用户已确认本轮补齐“完整确定性策略闭环”：策略定义、参数解析、基于标准化事实与无正文锚点元数据生成提案、统一复核和回放。暂停 Pi adapter、Tool、Skill 的实现。

本文件是供用户评审的设计提案，不是已实现接口，也不代表实施计划已获批准。书面设计通过后再制定实施计划、确认执行方式，并以失败测试推进实现；不生成提交、发布或远程写入。

整体结构以[架构总览](../architecture/README.md)为入口；策略支持矩阵及策略与配置关系在[架构目录](../architecture/policy-and-configuration.md)集中维护。本文件记录本次变更的精确契约和验收，不再充当唯一架构说明。两处目标设计都仍待评审，不因写入 living 文档而成为已实现或已批准能力。

期望结果：调用者提供“发生了什么、当前事实是什么、有哪些获准锚点”，而不必自己复制注意力策略、构造策略候选和决定动作。core 根据显式策略生成并筛选干预提案，保留现有有界投递机制。

## 2. 已实现与缺口

2026-10-25 核对源码并运行 `pnpm check`：50/50 单元测试、typecheck、build 通过，含 tarball 离线 JS+d.ts 消费；未运行本轮真实宿主或 token 实验。

| 现有模块 | 已有能力 | 不能据此宣称的能力 |
|---|---|---|
| profile | 全键匹配、用户覆盖、保守默认、原子校验 | 根据策略解析配置、自动标定 |
| decision | 固定的 reanchor 优先与有界 wake 选择规则 | 可定义或替换的策略 |
| policy-core | 接受调用者构造的候选，检查门槛并预留 | 从观察输入生成策略提案 |
| runtime / ledger / delivery | fence、预算、冷却、去重、prepare/commit | 完整策略闭环或真实宿主投递 |
| testing | 确定性回放现有接口 | 新策略生成链路或模型净收益 |

现有 `policyVersion` 只是配置匹配与归因字段，不会加载或执行策略。旧阶段零计划按其限定范围完成；不改写历史档案，但不再将其等同于本轮完整核心完成。

## 3. 边界与非目标

保留以下不变量：

- core 仅接收显式时间、规范化事实和无正文元数据；无 I/O、timer、宿主依赖或全局 registry。
- 消费者拥有业务语义、正文与 AnchorProvider；宿主拥有事实采集、唯一 session emit owner 和投递。
- 策略是有界纯数据，不接受脚本、函数、任意谓词、自然语言判定或在线 LLM judge。
- 策略不能推断“模型已经忘记”“任务需要协作”，不能创造宿主能力。
- 默认 off；wake 必须显式获准。未标定的模型或环境不能自动 emit。
- 不建设 scheduler、记忆库、daemon、持久补发、在线调参或跨进程恢复。

本轮新增的是通用注意力提案生成，不是把业务候选生产、检索或 Pi 事件处理整体搬进 core。

## 4. 领域概念

| 概念 | 定义 |
|---|---|
| 策略 Policy | 具备稳定 id/version 的注意力规则定义，描述触发条件、锚点选择和可提出的动作 |
| 规则 Rule | 策略中的有序条目，匹配标准化触发与锚点；不拥有预算或独立投递权 |
| 配置档 Profile | 已验证的特定环境与策略版本参数；不是策略本体，也不是生成器 |
| 生效策略 ResolvedPolicy | 策略定义与生效参数的隔离快照，包含参数来源和完整归因 |
| 观察 Observation | 外部捕获 fence 的一次标准化事件、当前宿主事实和获准锚点元数据 |
| 提案 Proposal | core 根据规则生成的动作候选；没有投递权，不是 reservation 或 permit |
| 决策 Decision | 提案经过统一门槛后的沉默、shadow 或带预留的动作结果 |

“根据策略生成”包含解析生效参数和生成本次提案；不包含凭空生成经过标定的 Profile、提醒正文或采用结论。

## 5. 方案取舍

| 方案 | 取舍 |
|---|---|
| 仅为现有固定规则添加策略名称 | 改动小，但调用者仍需生产候选，不能满足已确认的完整闭环 |
| 单一生效策略 + 有界类型化规则 | 本提案推荐，待评审；可表达注意力触发、锚点选择与动作约束，易于验证和确定性回放 |
| 通用条件 DSL / 可执行插件 / 多策略注册平台 | 不采用；扩大校验、组合与执行风险，当前没有相应需求 |

本提案建议一个 core 同时只有一个生效策略，多个关注点用其有序规则表达，不增加策略 registry、自动发现或多个账本；这是待评审的具体模型，不是现有命名策略接口。

## 6. 总体链路

```text
策略定义 + 环境 + Profile + 用户覆盖
                  ↓ resolvePolicy
             生效策略与参数
                  ↓
外部 Observation → 规则匹配 → 有序提案 → 统一安全门槛
                                           ↓
                               silent / shadow / reservation
                                                    ↓
                              最新快照与事实 → prepareDelivery
                                                    ↓
                                  宿主同步提交 → commitDelivery
```

宿主仍负责提供事实，不负责复制规则。正文只存在于消费者和宿主投递路径，不能进入上述策略、观察、状态或日志。

## 7. 策略定义

以下类型为待实现的契约骨架：

```ts
type AttentionTrigger =
  | "request-ready"
  | "anchor-updated"
  | "context-restored"
  | "settled";

type AnchorSelector =
  | { kind: "offered" }
  | { kind: "provider"; provider: string }
  | { kind: "ref"; ref: AnchorRef };

interface AttentionRule {
  id: string;
  triggers: readonly AttentionTrigger[];
  selectors: readonly AnchorSelector[];
  actions: readonly ActionKind[];
}

interface AttentionPolicy {
  id: string;
  version: string;
  defaults?: Partial<Omit<PolicySettings, "mode" | "allowReanchor" | "allowWake">>;
  rules: readonly AttentionRule[];
}
```

- 数组表示规则优先级；不另加 priority、权重或随机排序。
- triggers、selectors 分别为“任一匹配”；一条规则匹配一个锚点至多生成一次提案。
- offered 只匹配本次输入显式提供的锚点，不扫描文件或发现 provider。
- actions 是允许提出的动作集合，数组顺序无效；已有下一请求时永远不能改提 wake。
- 规则只能收紧动作集合，不能绕过生效配置、宿主能力与强制门槛。
- 触发名描述已观察事件，不自动证明当前事实。例如 settled 事件到达时若当前 activity 已 active，不能 wake。
- 本轮不提供正则、任意标签表达式、业务字段条件或可执行扩展。

定义必须为普通纯数据：拒绝未知字段、访问器、非法原型、数组空洞、重复 id、重复集合值、空规则/集合和不支持的枚举。

策略 id/version 必须标识同一份规范化定义。规则顺序、选择器或 defaults 的实质变更须更新 version；applyConfig 在当前实例发现相同 id/version 却有不同规范化定义时整体拒绝。规则顺序保留，trigger/action 集合与 selector 的或集合采用固定顺序规范化；不按对象键插入顺序判断差异。

跨实例或切换到其他策略后再次使用某个身份时，版本与内容一致由配置发布者保证；core 不为此引入历史 registry。纯数据校验不是执行恶意 JavaScript/Proxy 的沙箱。

## 8. 观察输入与责任

`core.evaluate` 改为接受一次观察，不再要求调用方构造 AttentionCandidate：

```ts
interface ObservedAnchor {
  anchor: AnchorMetadata;
  evidenceCount: number;
}

interface AttentionObservation {
  fence: PolicyFence;
  trigger: AttentionTrigger;
  observedAt: number;
  decisionDeadline?: number;
  provenance: "external" | "attention";
  facts: {
    nextRequest: "available" | "none" | "unknown";
    activity: "active" | "settled" | "unknown";
    continuation: "present" | "none" | "unknown";
    capabilities: { reanchor: boolean; wake: boolean };
  };
  anchors: readonly ObservedAnchor[];
}

interface EvaluateInput {
  observation: AttentionObservation;
  now: number;
}
```

- fence 在外部事件发生时捕获，不能在旧 callback 执行时换成最新 fence。
- observedAt 不晚于 now；保留单调、安全整数时间与显式 deadline 契约。
- evidenceCount 按锚点提供，来源为可复算的确定性证据，不能用一个锚点的证据授权其他锚点。
- 每个 provider/id 在一次输入中唯一；重复引用即拒绝，不能以不同版本、expiry 或大小混入相互矛盾的“当前快照”。
- anchors 允许为空，表达当前没有有效锚点；这不是输入格式错误。
- 观察不携带正文、路径、业务对象或未约束的 facts。
- 身份与纯数据校验完成后才允许推进 core 时间或改变状态。
- 原始宿主事件归一化、证据计算、权限控制和正文 bytes 真实性仍由外部负责。

## 9. 参数解析与 Profile 关系

保留保守默认，解析顺序为：

```text
库的 conservative 默认
  → 策略的数值参数 defaults
  → 完整精确匹配的 Profile
  → 显式用户 override
  → 整体校验与隔离快照
```

策略 defaults 不得设置 mode、allowReanchor、allowWake；其中 mode 默认 off、allowWake 默认 false，只能由精确 Profile 或用户显式覆盖改变。策略 actions 允许 wake 不等于允许实际唤醒。

Profile 继续精确匹配宿主、provider/model/revision、任务、角色拓扑及文案版本，并加入 policyId；policyId/policyVersion 从当前策略派生，不允许运行上下文另填冲突值。

`AttentionConfig` 提供 policy、外部环境 context、profiles 和 override；Profile 条目保留包含策略身份的完整 context。无 config 时使用内置保守策略与未知环境，仍为 off。

未知环境、策略 id/version 变化导致无精确匹配时，默认仍为 off；显式用户 override 的行为保持可见和可撤回。不按品牌名、排行榜或“相似模型”填补参数。

`resolvePolicy` 返回以下隔离结构；对每个 PolicySettings 字段记录最终来源，不记录正文：

```ts
interface ResolvedPolicy {
  definition: AttentionPolicy;
  context: ProfileContext;
  settings: PolicySettings;
  profileId?: string;
  origins: Readonly<Record<keyof PolicySettings,
    "conservative" | "policy" | "profile" | "user">>;
}
```

profileId 仅在存在精确匹配时提供；没有匹配时不伪造 Profile。规则定义与生效参数分开，用户覆盖不会篡改原始定义。

非法配置整体拒绝；成功替换包含策略定义和参数的完整配置后统一推进 revision。不得为了每次 evaluate 而反复 applyConfig，也不在线学习或发布 Profile。

## 10. 提案生成与确定性选择

每次 evaluate 的执行顺序：

1. 完整校验输入并复制为隔离数据，再按 now 执行既有惰性清理。
2. 校验 active、完整 fence、provenance 和 mode；旧事件、自激、off 不进入提案执行。
3. 按规则声明顺序筛选 trigger。
4. 对各规则匹配 selectors；锚点按 provider、id、version 的 UTF-16 字符串比较顺序排列，不依赖输入顺序或 locale。
5. 为匹配的规则/锚点组合生成内部提案，继承观察的 fence、来源、时间、期限和该锚点的 evidenceCount。
6. 先检查该锚点的关联、期限与大小，再依据证据、规则动作集合、生效开关和当前事实选择动作，最后检查全部共享账本门槛；保留现有门槛优先级。
7. 第一个通过全部门槛的提案成为本次结果；至多签发一个 reservation，或在 shadow 中记一次模拟尝试。
8. 前一个提案因 duplicate、失效、不支持等原因被抑制时可继续检查后续提案；不能改变先前提案的身份或绕过共享预算。
9. 全部抑制时返回声明顺序中第一个提案的抑制原因与归因；没有提案则区分规则不匹配、无锚点或无匹配锚点。

不会先为全部提案预留，也不会为未选中的提案消耗尝试预算。保留未知状态不推断为 none、有下一请求不降级为 wake 的规则。

新增 no-matching-rule、no-matching-anchor 抑制原因。早期生命周期/mode 抑制优先；否则依次判断：没有 trigger 匹配规则为 no-matching-rule，有规则但 anchors 为空为 missing-anchor，有锚点但无 selector 命中为 no-matching-anchor。已有提案则采用首个被抑制提案的既有原因。无 proposal 的抑制不携带虚构 ruleId。

## 11. 决策归因与观测

每个决策具有 `policy: { id, version, ruleId? }`；已选提案或首个被抑制提案提供 ruleId，没有提案时省略。evaluate 决策补充 `trace: { trigger, matchedRuleCount, consideredProposalCount }`，分别表示当前观察触发、trigger 匹配的规则数与实际检查的提案数。早期抑制的两个计数均为零；reason 继续使用有界枚举。

reservation 与 permit 的 policy.ruleId 必填，并与其 fence、锚点版本共同参与 prepare/commit 的关联校验。策略归因由 core 生成；外部不能用新身份改写旧票据。prepare、commit、timeout 日志保持票据原有归因，不用新配置覆盖旧尝试。

`PolicyState.policy` 返回隔离的 ResolvedPolicy，替代旧的顶层 profile 字段。日志保存 policy 归因、context/settings/profileId/origins 摘要与既有事实/元数据，不重复保存完整规则定义或全部提案列表。

最终说明与日志不承诺穷举所有未选规则。adoption/cost 继续为 unobserved；shadow 的 wouldAction 不是提交。

## 12. prepare、配置与生命周期

- prepare 使用当前 fence、选中锚点的最新元数据及当前 AttentionFacts；evidenceCount 必须仍属于该锚点。
- 重新检查原规则的动作集合、选择器、当前机会与全部共享门槛，不能偷偷改规则、锚点版本或动作。
- 原事件 trigger 只是该提案的来源，不用一次新观察替换它；若需要换规则或动作，重新 evaluate。
- 策略定义实质改变须更新 version；策略、Profile、参数或规则顺序的合法替换均通过 applyConfig 原子应用并推进 revision，使旧预留、许可、回执失效。
- 策略切换、关闭/重新开启和模式切换不清真实预算、cooldown 或去重，不自动重放旧观察。
- 保留现有 activity/session/reload、incarnation、close、自激防护和 shadow 独立账本语义。
- prepare 成功即记尝试；failed/unknown 不退款、不自动重试；有界幂等与超时 unknown 不变。
- prepare 到同步 sink 之间仍不得 await、缓存许可或变更生命周期。core 不调用真实 sink。

## 13. 内置策略与端到端例子

本提案拟提供两个显式、版本化的参考定义，用于直接使用和契约测试；两者当前均未实现、未导出，待书面评审：

| 策略 | 允许的行为 |
|---|---|
| reanchor-only / 1 | 对四类标准触发检查本次 offered 锚点，只能提出 reanchor |
| opportunity-first / 1 | 同上；有下一请求优先 reanchor，无下一请求时才可能提出受限 wake |

两者的参数 defaults 都不冒充本地标定结果，不自动打开 mode 或 wake。未传 config 时选择 opportunity-first / 1，但仍为 conservative/off。参考定义对外深度冻结，core 构造时再隔离复制，不能通过修改共享对象改变默认策略。

示例闭环：

1. 选择 reanchor-only / 1，并显式设置用于测试的 emit 与参数。
2. 消费者提供规则和角色两个锚点的当前元数据及各自证据。
3. 输入 request-ready 观察和 available 请求事实；core 按规则与引用排序选择首个合格提案。
4. 该锚点已去重时继续考虑另一个，不要求消费者重写相同策略。
5. 投递前规则更新为新版本，prepare 拒绝；不投递旧正文，也不偷偷替换为新正文。
6. 重新观察后才可重新产生提案。
7. 将事实改成 settled、无下一请求且无 continuation：reanchor-only 保持沉默；opportunity-first 仅在显式允许 wake 且所有门槛通过时可提出 wake。

此例证明策略差异，不证明真实模型收益或 Pi 注入能力。

## 14. 有界性与错误模型

新增纯数据容量上限：策略 1 个、规则最多 16 条、每规则 selector 最多 16 个、单观察锚点最多 64 个；trigger/action 集合分别最多 4/2 个。

每次最多检查 16 × 64 个规则/锚点组合；选择器重复命中不重复生成。策略与规则身份字符串最多 128 字符；引用、元数据及既有状态容量限制保持原契约。

这些是资源安全上限，不是模型频率标定参数。超过上限、未知字段、重复标识、非法时间或数值显式报错，不截断、不静默丢弃。

策略或观察校验失败不修改 revision、时间、账本或预留。正常抑制返回结构化 silent；事实未知不等于格式错误。

## 15. 公共接口迁移与模块职责

本库 private、实验性、未发布，本提案选择一次明确的公共契约迁移，不维护可绕过策略的并行旧入口；此项需随书面设计一并批准。

| 原接口 | 新契约 |
|---|---|
| resolveProfile(config) | resolvePolicy(config)，统一解析定义、参数与归因 |
| evaluate({ candidate, anchor, now }) | evaluate({ observation, now })，core 内部生成提案 |
| 外部构造 AttentionCandidate | 只提供 Observation；提案为内部实现，不可兑换执行权 |
| context 中手写 policyVersion | 从 policy.id/version 派生；Profile 按两者精确匹配 |
| prepare/commit/transition/close/getState | 保留职责，补齐策略归因与原规则复核 |

最小公开面是 resolvePolicy、createPolicyCore、两个参考策略及必要纯数据类型，不导出独立执行提案或跳过复核的方法。

实现按职责分为定义/类型、参数解析、观察校验、纯提案生成与既有 runtime/ledger/delivery。单文件不超过 500 行，函数尽量不超过 50 行；不预先新增宿主入口或独立包。

## 16. 验收矩阵：全部满足才称核心完成

| 验证对象 | 必须覆盖的断言 |
|---|---|
| 定义校验 | 非法结构、重复/未知项、函数/访问器、边界容量、同 id/version 不同定义整体拒绝，不改变运行态 |
| 参数解析 | policy 默认、精确 Profile、用户覆盖/撤回、逐字段来源、派生策略身份、跨策略不误匹配、未知仍 off |
| 输入校验 | fence 捕获、旧事件、自激、时间、锚点引用唯一、每锚点证据、不可信数组 |
| 提案生成 | trigger/selector 匹配、规则顺序、锚点输入乱序结果一致、单 selector 重复命中去重 |
| 确定性选择 | 首个通过门槛者胜出、首项被抑制可检查下一项、至多一个预留、全部抑制归因稳定 |
| 策略差异 | 相同观察下两个策略按定义产生不同结果；不能只修改 Profile 来冒充差异 |
| 强制门槛 | 策略不能绕过活动/continuation/能力、版本/expiry、预算/cooldown、去重/容量 |
| prepare 复核 | 策略更新、动作/版本/证据变化、删除、期限收紧、许可单次与真实尝试保留 |
| 生命周期与模式 | 旧回调、A→B→A、close、配置原子性、切策略不退款、shadow 不投递且不补发 |
| 确定性回放 | 从配置+观察到提案选择、预留、prepare、fake sink、commit 的完整闭环及规则/角色双来源负例 |
| 包消费 | 实际 tarball 离线 JS+d.ts 消费新公开面，拒绝私有入口和未实现的 /pi；零 runtime dependencies |
| 文档与注释 | 当前架构、用法、边界、验证及中文 JSDoc 与实现一致，不把待实现写成已完成 |

迁移既有测试时保留其安全断言，不以删除、skip、改成实现细节测试或仅静态类型通过代替。新行为先写并运行失败测试，再实现；默认测试保持零 token。

## 17. 完成后的决策门禁

本设计与实施计划分别评审。实施完成后，living 文档必须提供当前数据流、配置解析顺序、至少一个可运行的完整例子、公共接口迁移表和实测验收记录。

只有核心验收矩阵全部通过，才重新讨论 Pi 接入；核心通过仍不证明宿主同步投递可实现或模型具有净收益。不得新增空 /pi、Tool、Skill、MCP 或线上默认 emit 作为“完成”的替代。
