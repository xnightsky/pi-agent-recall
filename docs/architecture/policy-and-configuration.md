---
type: architecture
---
# 策略与配置：支持矩阵、关系与覆盖边界

本页集中回答“已实现哪些策略行为”“现有接口能做哪些操作”与“策略如何受配置影响”。已实现行为见第 1–3 节，[当前可执行的策略操作](#11-当前可执行的策略操作)见第 11 节；标注目标或待评审的名称、类型和解析接口不能当作现成能力。

## 1. 当前实际支持的策略

**只有一套固定动作选择逻辑，没有公开的命名策略定义、选择或注册接口。**

本页用“请求机会优先、停后有界唤醒”概括这套逻辑；这是说明性称呼，不是包中导出的策略 id。实现位于 [decision.ts](../../src/core/decision.ts)，配置类型位于 [profile-types.ts](../../src/core/profile-types.ts)。

在候选、锚点及共享门槛有效的前提下：

| 当前事实 | 固定规则 |
|---|---|
| 明确存在下一请求 | 只考虑 reanchor；动作关闭或能力不支持时沉默，不能改为 wake |
| 无下一请求，且 settled、明确无 continuation | 仅在允许且支持 wake 时考虑 wake |
| 下一请求状态未知，或 wake 路径所需状态未知 | 沉默，不把 unknown 当成 none |
| 没有有效锚点、证据不足或任何共享门槛不通过 | 沉默 |

这套规则接收外部已构造的候选，不监听真实事件、不选择内容来源，也不会自动启动 Pi。

当前没有随包提供经过本地标定的模型 Profile 集合；调用者提供 profiles。测试中的 calibrated 只是 fixture 名称，不是生产标定证明。

## 2. 已实现的行为组合与配置

allowReanchor 与 allowWake 可以配置出以下行为。这些行为已由同一套固定规则实现，不是四个独立命名策略：

| 已实现的行为组合 | allowReanchor | allowWake | 实际限制 |
|---|---|---|---|
| 仅重锚定 | true | false | 只允许借已有请求提供锚点，不主动新增推理 |
| 重锚定优先、停后有界唤醒 | true | true | 已有请求只考虑 reanchor；明确停后才可能 wake |
| 仅停后有界唤醒 | false | true | 有下一请求时仍沉默；无下一请求且满足停后条件才可能 wake |
| 禁止非沉默动作 | false | false | 在 shadow/emit 中仍会评估候选，但两类动作均不允许；不是关闭整个运行模式 |

这些组合还受 mode、证据、能力、预算等全部门槛约束，不能计作四个已实现的命名策略。默认值为 mode=off、allowReanchor=true、allowWake=false，所以默认不会产生可执行动作。

## 3. 运行模式与动作也不是策略

| 概念 | 当前取值 | 含义 |
|---|---|---|
| 运行模式 | off / shadow / emit | 不产生动作、独立模拟，或允许进入真实预留/许可链路 |
| 决策结果 | silent / reanchor / wake | 对一次输入的结果；非沉默结果首先只是预留 |
| 动作开关 | allowReanchor / allowWake | 授权上限，不证明当前有机会或能力 |
| 环境 Profile | 调用者提供的参数预设 | 按完整环境键匹配，不改变固定动作算法 |

emit 不等于已向宿主发送；core 仍不执行 sink。shadow 的 wouldAction 不等于 reservation、submitted 或 adopted。

## 4. 待评审的参考策略与不支持项

下列两个名字只出现在本轮设计提案中，当前源码没有相应定义或导出：

| 拟议策略 | 拟议行为 | 当前状态 |
|---|---|---|
| reanchor-only / 1 | 只提出 reanchor，始终不提出 wake | 未实现，待评审 |
| opportunity-first / 1 | 优先利用已有请求，否则在停后条件成立时才可能提出 wake | 未实现，待评审 |

第一个行为可以用现有开关近似限制；第二个行为接近当前固定规则，但都不等于已有一等策略对象、策略生成与归因接口。

当前也不支持：

- 按规则定义从标准化事件生成提案、选择多个锚点并仲裁。
- 按轮次、token 数、遗忘曲线或定时器自动构造召回机会。
- 自然语言条件、语义遗忘判断、在线模型评估或自动调参。
- 任意脚本策略、通用 DSL、插件 registry 或跨会话调度。
- 创建、注册、删除独立策略，或按策略 id 选择、加载和切换策略。
- 自动生成或标定模型 Profile；读取和校验配置不会生成效果证据。

冷却时间只是门槛，不是 timer；evidenceCount 是外部提供的事实，不是 core 自动计算的遗忘评分。

## 5. 策略、配置与 Profile 的概念关系

以下是目标架构的概念划分；完整闭环方向已确认，具体契约仍待评审。

| 概念 | 负责什么 | 不是什么 |
|---|---|---|
| Policy：策略定义 | 行为本体：何种标准触发、哪些锚点、允许提出什么动作及参数默认值 | 运行事实、正文、投递实现 |
| Config：配置 | 选用哪份策略、在哪个环境使用、提供哪些参数和显式授权 | 策略算法本身，也不只是 Profile |
| Profile：环境参数预设 | 为特定环境与策略版本提供可复用参数；有证据后才能称已标定 | 全部配置、策略类型或生成器 |
| Override：显式覆盖 | 用户明确调整允许配置的参数和运行开关，可撤回 | 绕过规则、宿主能力或安全门槛的特权 |
| ResolvedPolicy：生效策略 | 定义与参数解析后的隔离结果，包含版本、来源和匹配信息 | 自动学习得到的 Profile |
| Observation：运行观察 | 本次触发、当前事实、获准锚点元数据与捕获 fence | 静态配置或模型主观判断 |

配置可以选择并参数化策略；Profile 只是其中一个可选参数来源。不能将“有 Profile”当成“有完整策略”，也不能将“生成生效参数”写成“自动生成已标定配置”。

```text
配置 Config
  ├─ 选择 → 策略定义 Policy
  ├─ 提供 → 环境信息
  ├─ 选配 → 环境参数 Profile
  └─ 提供 → 用户显式覆盖
                 ↓ 校验、解析与来源记录
          生效策略 ResolvedPolicy
                 + 本次运行观察
                 ↓
              干预提案
                 ↓
             统一安全门槛
```

## 6. 字段所有权与覆盖权限

下面按架构职责分类；具体目标字段集合仍待书面评审，不能读作当前已有接口。

| 类别 | 归属 | 配置可以做什么 | 不能做什么 |
|---|---|---|---|
| 触发规则、锚点选择、动作集合 | 策略定义 | 选择或替换明确版本的策略 | 用 Profile 偷偷改规则结构 |
| mode、动作授权开关 | 显式配置或有验证依据的环境预设 | 关闭、shadow；显式允许进入 emit 或允许某动作 | 从规则意图推导出自动授权 |
| 阈值、预算、冷却、TTL、容量 | 允许配置的生效参数 | 在代码校验范围内取值并保留来源 | 关闭校验、重置已消耗账本、创造无限容量 |
| nextRequest、activity、continuation、capabilities | 宿主运行观察 | 由可信宿主适配层采集当前事实 | 用 Profile 伪造 settled 或不存在的能力 |
| 锚点版本、expiry、大小、证据 | 当前来源快照与确定性证据 | 由消费者/组合层提供并在投递前复核 | 用静态配置代替当前快照 |
| fence、单次许可、幂等规则、失败不退款 | core 执行不变量 | 没有跳过这些检查的配置项 | 策略、Profile、用户覆盖均不能绕过 |

数值可调与门槛不可绕过并不矛盾：可以配置预算上限，但每次动作仍受该上限检查，切换配置也不会抹掉已记次数。

## 7. 当前配置如何解析

当前 AttentionConfig 只有 context、profiles、override，没有 policy 字段。解析链路已经实现：

```text
conservative 默认
  → 完整精确匹配的 Profile
  → 用户 override
  → 整体校验后的 ResolvedProfile
```

- context 按 host/version、provider/model/revision、taskFamily、roleTopology、policyVersion、reminderTextVersion 全键精确匹配。
- 无匹配 Profile 时仍使用 conservative/off；用户可以显式覆盖，并可撤回。
- 未知模型不按名称猜测能力；配置校验不证明参数有效或已标定。
- policyVersion 目前只是匹配与归因字符串，不绑定实际策略定义。
- 成功 applyConfig 整体替换并推进 revision，使旧票据失效；非法配置整体拒绝。
- 解析配置不产生候选，不发送提醒，也不证明模型采用。

## 8. 目标参数解析如何补齐

以下为待评审提案，不是当前 resolveProfile 的行为：

```text
conservative 默认
  → 策略的数值参数默认值
  → 与策略身份及环境精确匹配的 Profile
  → 用户显式覆盖
  → 校验并形成 ResolvedPolicy
```

目标中的关键约束：

1. 策略定义与生效参数分开；覆盖参数不会篡改原规则。
2. 策略默认值不自动开启 mode 或动作授权；未知环境仍默认 off。
3. 策略动作集合、配置授权、宿主能力和事实机会取交集，不是后者覆盖前者。
4. 策略 id/version 从定义派生并参与 Profile 匹配，避免两条不同策略误用同一参数预设。
5. 每个参数记录 conservative / policy / profile / user 来源，缺失标定不能伪造为已验证。
6. 定义实质改变需更新策略版本；配置替换统一失效旧票据，不清真实账本。
7. 不在每次 evaluate 前重建配置，不运行在线自动调参。

“一个生效策略 + 有序有限规则”、参考策略名称、新字段和 resolvePolicy 接口仍需书面批准；这里只明确它们在总体架构中的位置。

## 9. 三个检验关系的场景

### 当前已实现：关闭 reanchor 不会升级成 wake

即使 allowWake=true，只要 nextRequest=available 且 allowReanchor=false，结果仍为沉默。开关授权不能改写机会类型。

### 目标待实现：Profile 不能改掉策略的动作边界

选择 reanchor-only 后，即使某 Profile 或用户允许 wake，策略本身不允许提出 wake；最终仍不能唤醒。若要改变行为，必须明确选择另一份策略，而不是偷偷覆盖规则。

### 当前已实现：切配置不重开预算

已有真实尝试后替换 Profile 或 mode，真实次数、冷却与去重不会清零。新配置可以改变合法参数，但不能把历史记账伪装成未发生。

## 10. 支持声明与验证依据

支持清单以 [公共导出](../../src/core/index.ts)、[固定动作实现](../../src/core/decision.ts)、[公开方法契约](../../src/core/runtime-types.ts)、[replay](../../src/testing/replay.ts)、[策略行为测试](../../tests/unit/policy.test.ts)和[配置测试](../../tests/unit/profile.test.ts)为依据。投递、生命周期和回放的断言分别见 [delivery](../../tests/unit/delivery.test.ts)、[lifecycle](../../tests/unit/lifecycle.test.ts)与 [replay 测试](../../tests/unit/replay.test.ts)。

当前测试只证明固定规则及配置契约，不能证明本页目标部分已实现。新增策略后必须同步更新本页的名称、行为、约束、默认状态、实现状态和验证依据，不能只在 spec 中添加一个名字。

## 11. 当前可执行的策略操作

**以下均是已经实现的 JS/TypeScript SDK 操作，不代表已有 CLI、模型 Tool 或 Pi 命令。** 它们操作的是当前固定规则的参数、候选和执行状态，不是独立策略对象的增删改查。

| 已支持的操作 | 实际公开接口 | 输入前提与结果边界 |
|---|---|---|
| 预览当前参数方案 | resolveProfile(config) | 按完整 context 解析 Profile/override，返回生效参数与整体来源；不改变运行态，也不自动标定 |
| 创建会话局部策略内核 | createPolicyCore(options) | 组合根提供 scope、owner、唯一 incarnation；无配置时 off，不自动发现宿主或 owner |
| 替换参数方案、撤回用户覆盖 | core.applyConfig(config) | 整体替换；撤回时重新提供不含 override 的完整配置，恢复精确 Profile 或默认；成功使旧票据失效，真实记账保留 |
| 关闭、影子预演或授权干预 | applyConfig 中设置 mode | off/shadow/emit 均已支持；emit 只允许进入预留/许可链路，不会自行发送 |
| 限定干预形式 | applyConfig 中设置 allowReanchor / allowWake | 支持第 2 节的四种行为组合；不能将当前 reanchor 机会升级成 wake |
| 调整频控和资源参数 | applyConfig 中设置阈值、预算、冷却、TTL、容量 | 参数须通过校验；不重开已消耗预算，不提供禁用安全检查的开关 |
| 评估一次候选 | core.evaluate(input) | 调用者提供有效候选、单个锚点元数据、当前事实与 now；返回 silent、shadow 说明或 reservation，不自动生成业务候选 |
| 投递前重新复核 | core.prepareDelivery(id, input) | 使用当前快照元数据和事实；成功至多签发一次 permit，并立即保守记尝试 |
| 记录投递回执 | core.commitDelivery(permit, result, now) | 只接受 submitted/failed/unknown；有界幂等，失败不退款，也不代表调用了真实 sink |
| 响应真实外部生命周期变化 | core.transition(event) | 当前 external fence 才可推进 activity/session/reload；按生命周期重置阶段计数，仍保留冷却与去重，不是任意清账接口 |
| 永久停用旧实例 | core.close() | 旧实例失活、旧预留/许可失效；不会自动创建或恢复新实例 |
| 查询和解释当前状态 | core.getState() | 返回隔离的配置、fence、真实/模拟账本、待决数量和有界日志；读取不触发到期，也没有规则级归因 |
| 离线回放并对比参数方案 | /testing 的 replay(options, events) | 经同一公开接口回放候选评估、配置、生命周期、关闭事件及 fake 投递；可分别输入不同配置比较机制结果，不证明模型净收益或跨进程恢复 |

### 11.1 不投递地查看当前方案会怎样决策

```text
resolveProfile 预览参数
  → createPolicyCore / applyConfig 显式使用 shadow
  → 调用者提供候选，evaluate
  → 查看 evaluate 返回的 wouldAction，用 getState 核对模拟日志与账本
```

shadow 不是沿用真实已消耗预算的精确反事实；它使用独立账本，不产生 permit。完整构造与候选示例见[使用指南](../usage.md)。

### 11.2 授权后尝试一次有界干预

```text
applyConfig 显式使用 emit 与动作开关
  → 外部产生新候选，evaluate
  → 外部重新读取当前快照与事实，prepareDelivery
  → 宿主紧邻同步 sink 提交（core 外部）
  → commitDelivery 记录真实可观察结果
```

切换配置会使旧 fence/票据失效，不能复用 shadow 输入补发。当前这条链路可以由 fake 验证，但没有现成 Pi adapter；实际读取正文和发送仍由外部实现。

### 11.3 在相同事件上比较两个参数方案

分别使用配置 A/B 调用 replay，比较沉默原因、动作、预算、去重及 fake 回执结果。输入事件须遵守各自捕获的 fence 和时间契约，不能为了通过回放自动重写旧事件。

这属于既有固定规则的参数实验，不是创建两种新策略，也不是自动选出最佳 Profile。采用率、任务结果、token 和延迟收益仍需独立实验。
