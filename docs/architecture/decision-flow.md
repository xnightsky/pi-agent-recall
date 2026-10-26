---
type: architecture
---
# 决策链路：从外部事实到投递回执

本文集中描述一次决策的输入、阶段、执行权与失败语义。策略支持和配置关系见[策略与配置](policy-and-configuration.md)，状态与账本细节见[执行内核](core.md)。

## 1. 阶段不能混为一谈

| 阶段 | 含义 | 是否有投递权 |
|---|---|---|
| 外部事实 / 锚点元数据 | 对当前机会和来源的描述 | 否 |
| 策略提案 | 目标架构中由规则生成的候选；当前未实现 | 否 |
| reservation | evaluate 产生的临时预留 | 否 |
| permit | prepare 复核后签发的单次许可 | 仅供组合根紧邻同步 sink 使用 |
| submitted / failed / unknown | 对投递尝试的可观察回执 | 不是新许可，也不是 adopted |

非沉默决策不等于已经发送。正文读取、宿主提交和效果观察不发生在 core 内。

## 2. 当前已实现链路

```text
消费者准备当前候选与单个锚点元数据
                  + 当前宿主事实、显式 now
                              ↓
                   evaluate 固定规则与门槛
                     ├─ silent
                     ├─ shadow：silent + wouldAction
                     └─ reservation
                              ↓
                组合根重新读取快照和事实
                              ↓
                         prepare
                     ├─ rejected
                     └─ 单次 permit，立即计尝试
                              ↓ 紧邻同步边界
                         宿主 sink
                              ↓
                          commit
```

### 2.1 输入是谁生成的

当前公开调用为 evaluate({ candidate, anchor?, now })。调用者提供：

- 事件发生时捕获的完整 fence、observedAt、provenance 和可选 deadline。
- 请求机会、活动、continuation、证据数和宿主能力。
- 单个锚点引用及当前 version、expiry、sizeBytes。

core 不从 Pi 事件生成候选，也不从多个来源选择锚点。角色和规则来源 fixture 只是验证同一输入契约，不是消费者已接入。

### 2.2 evaluate 做什么

完整校验输入并按显式 now 惰性清理后，依次检查：

1. 实例、fence、自激来源与 mode。
2. 候选期限、锚点关联、存在性、expiry 和大小。
3. 证据与固定动作规则：已有请求只可 reanchor；停后才可能 wake。
4. 去重、预算、冷却、同锚点并发预留及容量。
5. 最终预留期限，取候选 deadline、anchor expiry、reservation TTL 和 wake TTL 的适用最小值。

真实模式的 evaluate 只预留，不消耗尝试预算。shadow 使用独立模拟账本，外部始终返回 silent，不生成预留或许可。

无机会但仍在明确 deadline 内可能返回 defer；这不代表 core 保存了重试任务、timer 或补发队列。

### 2.3 prepare 为什么不能省略

evaluate 与提交之间，活动、配置、锚点、证据和预算都可能变化。组合根必须重新读取当前完整快照，并计算实际编码大小；core 仍只接收元数据。

prepare 重新检查完整 fence、原引用及版本、当前事实/能力、有效期和所有共享门槛。版本更新、删除、机会或动作改变均拒绝，不能偷偷换正文或换动作。

同一预留至多成功一次。成功就保守计一次尝试，并生成单次许可；此时尚不能声称宿主已接受。

### 2.4 同步提交与回执

组合根在 prepare 成功后，用同一当前快照紧邻调用同步 sink；期间不得 await、重入 lifecycle/config、缓存或重复使用许可。

commit 只记录 submitted、failed 或 unknown：

- 明确交给宿主可记 submitted，但不能推断模型采用。
- 只有提交边界明确拒绝才记 failed；不确定就记 unknown。
- failed/unknown 不退款、不自动重试。
- 重复同结果回执在有界窗口内幂等，冲突显式报错；迟到或淘汰回执为 stale。
- 没有回执的尝试在后续携 now 的调用中惰性超时为 unknown，不会由后台 timer 自动处理。

core 无法替外部 sink 强制原子性或 exactly-once。真实宿主若只有异步接口，必须先重新评审或证明这条边界。

### 2.5 Pi 测试 adapter 的实际宿主链路

`src/pi` 已实现测试先行的组合根，但未加入 package exports。reanchor 在 `before_agent_start` 预留，在 `context` 重读快照、prepare，并返回请求级 custom message；wake 只在 `agent_before_settle` 的 completed、无既有 continuation/pending 边界评估，并返回 custom_message entry 与 `continue:true`。

Pi 的 `event.context.canContinue` 是追加草稿前的状态：最终为 assistant 时可以是 false，追加 custom message 后才形成可运行上下文，因此它不是 wake 的前置授权门槛。adapter 的 submitted 只表示本地同步 sink 草稿完成；provider 请求由 fake backend 独立举证，不能据此推断 Pi 接受后的网络结果或模型采用。

## 3. 目标闭环：新增的是哪里

已确认方向、尚未实现：

```text
策略定义 + 配置 → 生效策略
                         + 标准化观察
                         + 获准锚点元数据
                                  ↓
                           匹配规则与生成提案
                                  ↓
                           选择可接受的提案
                                  ↓
                       既有统一门槛与执行内核
                                  ↓
                    reservation → prepare → commit
```

宿主和消费者仍负责真实事实、业务证据与当前快照；core 新增通用注意力规则的提案生成。正文、检索、业务判断不会随之进入 core。

## 4. 目标提案生成的责任与待评审选择

| 部分 | 已确认的责任方向 | 当前具体提案，仍待评审 |
|---|---|---|
| 输入 | 外部提供观察和元数据，而非重复实现策略 | Observation 携标准触发、当前事实与逐锚点证据 |
| 匹配 | core 按策略决定哪些锚点相关 | 有序规则，明确 selector 与动作集合 |
| 仲裁 | 结果确定、资源有界、共用同一预算 | 按规则顺序和规范化引用排序，选择首个全部合格者 |
| 输出 | 提案不能绕过执行内核 | 一次观察至多产生一个预留，shadow 至多记一个模拟动作 |
| 归因 | 可解释规则命中与抑制 | 记录策略/规则身份、参数来源与有界检查计数 |
| 再复核 | 投递前重查原提案的约束 | 不能替换规则、锚点版本或动作；否则重新 evaluate |

多个提案被抑制时的具体优先级、新枚举和接口签名属于待评审契约，不是当前公开行为。

## 5. 当前内核必须继续保证什么

策略生成接入后，不能另建一套可以直接发送的路径：

- 每个提案必须经过 fence、自激、版本、期限、能力、证据和账本门槛。
- 生成多个提案不代表先为每个提案占用预留或预算。
- 配置/策略更新后旧预留失效，不能沿用旧事件的新 fence。
- prepare 失败后需要重新观察/评估，不能改写旧预留获得许可。
- shadow 切 emit 不补发历史提案，切策略不清真实记账。
- 输出不能把 wouldAction、reservation、permit、submitted 和 adopted 合并成一个“成功”。

## 6. 什么能证明这条链路完成

当前测试证明“外部候选到 fake 回执”。完整策略核心还必须证明：

1. 从策略定义、环境参数、观察和元数据出发，不手工构造内部策略候选。
2. 不同策略在相同观察下按定义产生差异，而不是只改开关。
3. 多锚点、负例、未知状态及规则优先级有稳定结果。
4. 生成链路接上 prepare/commit，并保留全部既有安全断言。
5. 配置、定义版本、生命周期和模式变化不能复活旧提案。
6. 同一输入可以通过公开接口确定性 replay，且包消费契约通过。

这些是纯 core/testing 验收，不证明 Pi 注入位置、宿主同步投递可实现或模型采用收益。真实宿主与 token 实验继续独立验证。
