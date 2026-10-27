---
type: research
date: 2026-10-24
---
# 模型记忆曲线、注意力衰减与角色／规则遗忘：非业务调度干预

> 来源快照：复制自内部事件总线仓同路径（该仓未公开），源仓保持只读。论文结论保留原始核验时点；新增评分研究必须重新核验原文与数据。下文涉及的内部知识库文档均为未公开外部来源，不表示本库依赖或已接入它。

> 基于本调研并经用户确认的库设计见 [Agent Attention Policy 设计](../../spec/2026-10-24-agent-attention-policy-design.md)（待书面评审，不代表现状）。

> 本文是增量调研，访问日期为 2026-10-24。只讨论推理上下文、记忆与提醒，不提出业务 scheduler、第二套任务状态或消息设施。论文结论、官方机制说明与对 内部事件总线 的工程推断分别标明；arXiv 上存在证据不等于本仓有效。

## 1. 结论先行

1. **“记忆曲线”不是一条可跨模型套用的衰减函数。** 前瞻记忆、长上下文位置利用、规则持续遵循、压缩后状态恢复和停后未再推理是不同故障。turns/bytes/idle 至多是候选代理量，不是遗忘测量值。
2. **请求前、选择性、短而具体的 re-anchor 是成本最低的通用候选；停后 Wake 解决的是另一个缺口。** 前者依附本来就会发生的模型请求，不能唤醒已停会话；后者多一次模型 run，也不能保证模型采用提醒。二者不是替代关系。
3. **静态 Skill/AGENTS、结构化 note/todo、RAG/memory 都主要解决“信息仍可取得”，不自动解决“到点想起并使用”。** 持久化、进入上下文、识别决策点、采取行动是不同观测层。
4. **按模型动态调整提醒力度合理，但只能按 `宿主 × 模型 × 任务 × 策略版本` 标定。** 不能简化成“强模型少提醒、弱模型多提醒”：强模型也可能受益，弱模型也可能因更多提醒而过度行动；措辞和任务域会改变方向与幅度。
5. **无新信息的 keep-going/are-you-sure 不应升级。** FlipFlop 直接支持“盲质疑会翻掉正确答案”；它不是 Wake 角色提醒实验，因此只能作为反方边界，不能证明所有周期性提醒都有害。

## 2. 问题分层：先定位断点，再选干预

| 层 | 实际问题 | 可观察证据 | 不能混称 |
| --- | --- | --- | --- |
| 延迟意图／prospective memory | 已形成“以后某条件下要做”，却在当前活动中漏做、早做或执行旧版本 | due-time 命中、false alarm、更新违规、主动查询次数 | 能否复述旧文本 |
| 长上下文利用 | 规则或角色仍在 prompt 中，但位置、长度和干扰使其不能影响下一生成 | 控制位置后的答案/行为准确率 | 信息已丢失 |
| 指令持续遵循 | 多轮局部目标、工具结果或新指令逐渐压过原始约束 | 约束满足率、目标对齐、任务通过率 | 单纯检索失败 |
| 压缩／恢复后的锚点 | 摘要未保留角色、未决意图或证据指针，或保留后未重新进入决策 | 压缩前后同一探针、下一请求实际内容、后续采用 | 所有长上下文漂移 |
| 停后无决策机会 | 会话已 settled，没有下一请求可承载 reminder | 生命周期事件、注入及新 run 记录 | 模型在运行中遗忘 |
| 采用与过度干预 | 提醒到达但模型不采用，或为响应提醒而形式调用、误派工、翻掉正确判断 | adoption、false-route/false-action、任务结果与成本 | 投递成功即恢复 |

因此，本报告不寻找统一“提醒频率”。目标量是：**在正确决策期限前，让仍有效的最小信息重新影响行动，同时不为无需帮助的任务制造动作。**

## 3. 一手证据：实际测了什么，能推断到哪里

### 3.1 前瞻记忆：Todo 与 heartbeat 是不同干预，不存在通吃 scaffold

[PM-Bench（arXiv:2607.12385v1）](https://arxiv.org/html/2607.12385v1)用合成的模拟七日、80 步场景测试延迟意图，含跨日任务、取消/改期、隐藏状态频道和干扰项。8 个模型 × 8 种 agent 配置共 64 runs；主指标是到期动作集合的 Set-F1，同时记录 miss、false alarm、更新/依赖违规与查询成本。最佳配置也只有 65.1% macro Set-F1。

实测配置包括无 scaffold、每步携带并重写且最多 5 项的 Todo ledger、可选或固定 heartbeat，以及层级多 agent。结论是**没有单一策略跨模型占优**：ledger 偏向意图保持与精度，heartbeat 常提高监控和召回却增加 false positives；更多查询不等于更会选择。它是合成日程中的结构化动作选择，不是软件协作、角色广播或真实墙钟 Wake 测试。

**对 Pi 的有限推断：**“记得角色/待办”与“到点主动复查”应分别度量；Todo 可以是外部锚点，heartbeat/Wake 可以提供决策机会，但两者都可能把漏做换成多做。PM-Bench 不支持照搬 30/60 分钟周期，也不证明 事件总线 该建共享任务状态。

### 3.2 选择性记忆干预：有收益，但第二模型每步介入有明确成本

[Remember When It Matters（arXiv:2607.08716v1）](https://arxiv.org/html/2607.08716v1)把 memory agent 分为维护持久 memory bank 与决定“注入或沉默”两阶段；memory agent 每步查看任务、最近 8 条消息和 bank，若提醒则进入下一 action-agent 请求。Terminal-Bench 2.0 用最终 verifier 的 pass@1（85 个成对有效任务），τ²-Bench 用任务 evaluator 的 pass@1（278 任务/配置）。

以 Opus 4.6 为 memory agent：Terminal-Bench 上 Sonnet 4.5 从 37.6% 到 45.9%（+8.3pp），Opus 4.6 从 43.5% 到 45.9%（+2.4pp）；τ²-Bench 加权均值分别 +6.8pp 和 +2.5pp。**较弱模型收益较大，但较强模型仍受益。** τ²消融中，完整选择性方案 macro 最均衡；always-inject 的 micro 反而高 0.3pp，但在预期运行方差内且 macro 不占优。论文也明确承认每步 frontier-model 调用成本和不完美的干预标定，未训练的 27B memory agent 在其 SETA 设置中先造成下降。

**对 Pi 的有限推断：**“持久记录 + 选择性提供具体状态”值得实验，不能推出每步注入或每步 judge 最优，更不能把该 pass@1 当角色召回收益。事件总线 已有角色记录，无须复制其 memory bank。

### 3.3 多轮目标提醒：指标是相对参考策略的漂移，不是客观任务成功

[Drift No More?（arXiv:2510.07777v1）](https://arxiv.org/html/2510.07777v1)研究合成约束改写和 τ-Bench 用户模拟，以测试模型相对 GPT-4.1 参考策略的 token 分布 KL/JS、语义相似度及 LLM judge 对齐分度量漂移；固定第 4、7 轮重述目标。提醒使所测漂移与 judge 指标改善，作者同时限定模型和域较少、参考策略不完美，且未比较 retrieval/adaptive prompting/memory。

**对 Pi 的有限推断：**重述原始目标可以作为基线臂；这些结果既不是角色召回率，也不证明固定周期、全量角色文本或统一阈值最佳。“漂移趋于有限均衡”也反驳把 turns 当成必然单调遗忘曲线。

### 3.4 位置与上下文预算：最小高信号，而非把所有记忆再塞一遍

[Lost in the Middle（arXiv:2307.03172v2）](https://arxiv.org/html/2307.03172v2)在多文档 QA（10/20/30 文档，每档 2.7K 样本）与合成 KV 检索中控制相关信息位置。所测模型常呈首尾高、中段低的 U 形，且输入变长时表现下降；GPT-4 的 500 个 20 文档子集也呈类似趋势。它测的是答案准确率/检索，不是多轮指令服从或角色履职。

[Anthropic：Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)是供应商工程指南而非对照实验：主张有限注意力预算下选择“最小高信号 tokens”，以静态规则加 just-in-time retrieval 的混合方式，列出 compaction、结构化笔记和子 agent；并指出压缩可能丢掉后来才重要的细节，笔记需在以后重新取回。

**对 Pi 的有限推断：**把提醒放到相关下一请求尾部、只带当前有效角色或证据指针有机制合理性；不能声称尾部注入必然恢复，也不应以更长 AGENTS/Skill 解决所有遗忘。

### 3.5 反方：无信息质疑会把正确答案改错

[FlipFlop（arXiv:2311.08596v1）](https://arxiv.org/html/2311.08596v1)在分类任务中先取得答案，再用不提供新证据的 challenger 质疑。核心结果表覆盖 9 模型、7 任务、5 类 challenger 的 67,640 次实验（全文结论另按 10 模型概述）：平均约 46% 翻答、准确率下降 17%，73% 实验出现 minor/major deterioration；初始能力只中度预测降幅（ρ=0.52），任务域和 challenger 措辞影响显著。作者明确限制为合成分类对话，并排除接近随机水平的条件。

**对 Pi 的有限推断：**不要让 Wake 变成无证据的“你确定完成了吗/继续干活”，更不能以反复重催逼出动作。它直接反驳的是无信息质疑，不是“带当前角色记录或具体待查线索的一次自查”；严格中性的 keep-going 也不是该文直接测试的相同刺激。

## 4. 方案矩阵：位置、持久性和成本不同

“新 turn”指是否必须主动开启本已不会发生的 action-agent run；“持久”指提醒/信息是否留在上下文外或消息历史中，不指模型一定记得。所有方案都仍有输入 token 或维护成本。

| 方案 | 主要断点 | 需新 turn | 持久性 | 额外模型调用 | 主要风险／边界 |
| --- | --- | --- | --- | --- | --- |
| 静态 Skill / AGENTS | 稳定纪律首次披露 | 否 | 随宿主规则加载 | 无 | 下沉、规则稀释、可见不采用；不宜周期重发全文 |
| 请求前 reminder / re-anchor | 已发生的下一决策前恢复目标/角色 | 否 | 推荐仅本次请求、短暂尾部 | 静态版无 | 停后无效；cadence 噪声、缓存与重复组合需实测 |
| compaction 后短锚点 | 摘要后角色/未决意图/证据入口不可达 | 否，等下一请求 | 记录可持久；锚点可只注一次 | 锚点无；压缩本身可能另计 | 压缩事件不等于已遗忘；旧角色/旧事实、全文重注 |
| 结构化 note / Todo | 延迟意图与进展的外部可读记录 | 否 | 是，需更新/失效语义 | 通常无独立调用，但有生成/工具成本 | 不主动到点提醒；陈旧、误写、把 Todo 当验收 |
| RAG / memory bank | 大量历史按需取回 | 否 | 是 | 检索可无；agentic controller 可有 | 检索到不等于该介入；全 bank 曝光稀释，陈旧/隐私 |
| 停后 Wake | 没有下一请求，补一次自查机会 | **是** | 通常一次性消息；运行状态未必跨恢复 | 一次 action-agent run，非独立 judge | 空转、自激、过度行动；无法保证采用或找回已丢信息 |
| 运行中 LLM judge | 需理解轨迹才能发现语义偏离 | 否，steer 到下一请求 | 可实现为持续或短暂 | **有，第二模型** | 误判、成本/延迟、轨迹泄露；run 结束后不能兜底 |
| 强制 continuation / hard gate | 有确定性未完成条件时阻止收工/动作 | 通常是 | 取决于宿主 | 至少一次续跑 | 无信号续跑、震荡、副作用；不能由启发式遗忘代理触发 |

**优先级推断：**先利用已有记录做无额外模型调用的选择性锚定；确有“停后无机会”才保留有界 Wake；只有简单规则无法判断且收益覆盖成本时才考虑 judge。这里不是新 scheduler 需求，而是不同推理位置的工具选择。

## 5. Pydantic AI 官方机制说明了什么

本轮复核当前 [SystemReminders](https://pydantic.dev/docs/ai/harness/system-reminders/) 与 [TrajectoryJudge](https://pydantic.dev/docs/ai/harness/trajectory-judge/) 文档；它们是机制证据，不是 Pi 效果实验。

- `Reminder` 可按 model-request cadence 与条件触发；动态 reminder 每次请求求值。正文作为 ephemeral `UserPromptPart` 加到请求尾部，不写回 durable `message_history`，并试图以 `CachePoint` 保持前缀。缓存仍受 provider、TTL 和 breakpoint 数量限制。
- `GoalReanchor` 重述首个用户请求，不额外调模型；`LLMReminder` 默认每次动态求值会多一次模型调用，可用外层 cadence 限频。失败回退 GoalReanchor；当前文档说明会按 run 记录 warning，不能写成完全静默。
- `TrajectoryJudge` 默认每 10 个 model requests，以最近 20,000 token 窗口让第二模型输出 `AllGood` 或 `Steer`；最多一个 evaluation in-flight，慢则跳 tick。steer 在下一请求消费；run 结束时未完成评估被取消，所以**不是停后 Wake**。
- judge usage 进入父 run 预算；失败在下一 tick 或 run end 显式抛出。官方当前拒绝把 judged run 放进 Temporal/DBOS/Prefect durable workflow，避免未 journal 的评估在 replay 重放。它只观察和 steer，不是确定性门禁。

可通用借鉴的是“规则提醒先试、语义理解确有必要才买 judge”和短暂尾部注入；不可照搬默认 `every=10/window=20000`，也不应假设 Pi 有相同 cache/durability 语义。

## 6. 内部知识库项目（未公开）已有机制映射：可借结构，不搬阈值和事实

只读核对内部文档 `instruction-decay-reinjection`、`calibration`、`forced-continuation-vs-reminding` 与 `injection-contract`（均位于一个未公开的内部知识库仓，链接已脱敏）。核心映射如下，**不表示其机制已接入或适用于本仓**。

| 内部知识库 已有结构 | 可复用的抽象 | 对 事件总线 的限制 |
| --- | --- | --- |
| bootstrap / staleness / nudge / flow-gate / readanchor | 启动披露、运行中再同步、停后催办、确定性闸、压缩后指针是不同 kind | 事件总线 不应借名词扩成 KB flow 或任务状态机 |
| raw event → deterministic facts → optional classifier → policy | 宿主事实、可复算派生与概率语义分栏 | idle/bytes/compact 不是“角色已遗忘”；无 classifier 时语义为 unknown |
| `silent / L1 / L2`、预算、cooldown、shadow | 允许沉默；先测候选质量，再调正文和强度 | 不把 L1/L2 变成每次全量角色广播 |
| decision log 的 host/model/policyVersion、抑制原因 | 能区分未观察、未触发、被预算抑制、已投未采用 | 不另建 session registry；只记录实验所需最小事件 |
| `pre-engage` 与 `post-engage` 分离 | 首次意图保持和已有知识陈旧不是同一状态 | 事件总线 角色已持久，不可照搬 armed/debt 作为角色真相 |
| Pi `context` 请求前注入与 `agent_settled` 后 followUp | 清楚区分“下一请求锚定”与“停后新 run” | 具体事件行为须按本仓实际 Pi 版本再验证，不能拿 内部知识库 版本当本仓事实 |
| readanchor/readGate 的已读指针、变更检测思想 | 压缩后优先恢复短指针，外部确定性状态辅助模型记忆 | 事件总线 不复制 readLog，不扫描私有 transcript，不扩展成文件记忆系统 |

内部知识库 旧报告的“弱模型强制、强模型提示”只能视为当时假设；其自身也承认未隔离“同内容下强制 vs 提示”。结合本轮 PM-Bench、Remember 与 FlipFlop，**不应把 tier 分档继承为 事件总线 规则**。

## 7. 按模型 profile 动态调整：合理，但 profile 不是强弱排行榜

### 证据支持与限制

| 证据 | 支持 | 不支持 |
| --- | --- | --- |
| PM-Bench | 最优 scaffold 随模型变；召回、精度和查询成本需共同看 | 大模型一律少提醒，小模型一律多提醒 |
| Remember | 较弱 Sonnet 的增益较大；较强 Opus 仍有正收益 | 强模型不需要 memory；每步第二模型值得默认开启 |
| FlipFlop | 抗无信息质疑随模型、任务、措辞变；初始能力仅中度相关 | 用模型 tier 预测某一提醒文案的安全强度 |
| Drift No More | 少量模型中目标重述可改变所测对齐指标 | 统一周期、客观任务成功率或跨模型曲线 |
| Anthropic 指南 | 随能力与任务选择上下文策略，保持最小高信号 | 供应商经验等于 事件总线 本地 A/B |

最小 profile 键建议为：

```text
host + hostVersion + model (+ provider/revision)
+ taskFamily + roleTopology + compactionMode
+ policyVersion + reminderTextVersion
```

其中 `taskFamily` 至少分开机械单线程、需延迟委派、多角色接力、压缩恢复和合法等待；`roleTopology` 防止把“无需协作”误当遗忘。模型切换只说明需要重新标定，**本身不是触发提醒的证据**。

可动态调整的是提醒内容、触发候选、沉默比例、频控与是否升级；不可由 profile 自动改变角色分工、任务完成标准或宿主事实。先用离线/shadow 结果选择 profile，在线只使用已验证配置并保留全局关闭与上限，不做持续无界自我调参。

## 8. 通用化裁决

### 值得共享

- **策略流水线**：raw event、deterministic fact、semantic hypothesis、action、suppression、budget 分层；默认允许 `silent`。
- **最小 schema**：`triggerKind`、`anchorKind`、`anchorVersion`、`policyVersion`、`model/host/profile`、`newTurn`、`persistentScope`、`delivery`、`adoption`、`cost`；原始事实缺失用 `unknown/unobserved`。
- **提醒正文契约**：短、单一决策、仍有效、有来源；明确“复查”而非断言“你已遗漏”；无事允许沉默/结束；正文自包含但不重放完整协议。
- **标定协议与指标**：固定任务/模型/宿主/正文比较一个变量；同时记漏召回、误行动、采用、token、额外 run 和延迟；保存负例。
- **安全不变量**：有界频率/次数、防自激、用户可关、配置可撤回；持久记录与临时提醒分离；模型切换不继承未验证阈值。

### 不应共享

- 跨模型/宿主的 turns、bytes、idle、cooldown、最大次数和 judge cadence 阈值。
- “目标变化、正在收尾、需要协作、已经漂移”等语义结论，以及把 hook 原始事件冒充这些事实。
- 不同宿主的注入位置、缓存、持久化、settled/stop 和恢复语义。
- 角色职责、任务完成语义、业务 stuck/完成判据；这些仍属用户 Skill、工作流或外部 runtime。
- 为通用化而复制 memory bank、Todo、roster、消息队列或私有会话日志。

## 9. 对 内部事件总线 当前 Wake 的具体建议

以下是研究建议，不改变当前默认配置。

1. **保留 Wake 的独立定位和默认关闭。** 它补偿 settled 后没有下一请求的场景；不要用请求前 re-anchor 宣称替代它，也不要把 judge 当停后兜底。现有一次注入、merge/throttle、防自激和“无事”退出是必要成本边界。
2. **先改“信息质量”的实验，不先加频率。** 当前 `unsent/remindRole/maintainRole` 是语义自查机会，不是已知遗漏。正文应只陈述可证明来源：角色记录存在、命中了哪条自查规则、可复查哪些已有入口；避免无新信息的“继续努力/你确定吗”。
3. **角色提醒优先复用最终角色记录，而非只提醒“记得角色”。** 特别把旧报告指出的 `unsent + remindRole` 合并路径作为首个对照：该路径目前不带角色文本。候选臂注入同一角色记录的精简、当前有效版本；这仍是待测实验，不预判一定优于现文案。
4. **增加独立的请求前锚点候选，不塞进 Wake 触发器。** compact/resume 后下一次 `context` 可测试一次性短角色锚点；不为此新增 turn，不默认重发全量握手、AGENTS 或 Skill。先验证事件和实际投递，再测行为。
5. **Todo/消息只作已有下游的复查线索。** Wake 不扫描全局 Todo、不断言待办事实、不建立 ACK/重催闭环。只有确定性外部状态确实证明具体缺失时，才可把正文升级为具体信号；代理量本身不能升级成 hard continuation。
6. **不按模型名自动改现有规则。** 先为每个 profile 记录现策略基线；只有同一任务上出现稳定方向，才配置提醒文案、频控或开关差异。任何 profile 都不取消全局限额。

## 10. 最小 A/B 实验

### A：停后 Wake——同触发、同预算，只变正文信息

- **A0 当前臂**：现有 Wake 配置与文案。
- **A1 具体锚点臂**：完全相同的规则、时机、merge/throttle/repeat；角色相关命中时附当前角色记录精简版，unsent 只给“待复查类别/已有入口”，不伪造具体未完成事实。
- **任务**：固定三阶段多 Pi 协作剧本，覆盖应委派给 B/C、合法等待、无协作机械任务、角色变更和已正确完成；重复运行并随机交错臂，锁定模型/宿主版本和 token 预算。
- **主指标**：下一关键行动前的正确队友/角色采用率、应发而未发消息率；同时统计无事时正确停止。
- **反指标**：误派工、重复/无效广播、翻掉原本正确决定、旧角色采用、每成功恢复的新增 run/token。
- **判停**：A1 只增加回复或动作而不提高采用/任务结果，或误行动成本抵消收益，则不推广；不能用“Wake 后说话更多”判胜。

### B：下一请求锚定——不新增 turn 的独立小实验

在本来就会继续请求的 compact/resume 剧本中，A0 不补锚点，A1 仅下一请求一次性附同一精简角色锚点；不引入 Wake。比较压缩前后角色识别、正确协作采用和注入 token。它与 A 回答不同问题，不能把两组成功率直接混排。

### 标定顺序

先以机制 canary 证明正文只进入预期请求一次；再 shadow 标注“需要提醒/应沉默”和 decision deadline；随后同模型同任务跑 A0/A1；最后跨 `host × model × task` 复验。先固定正文比时机，再固定时机比内容，避免同时调频率、文案和模型而无法归因。

## 11. 核验记录与未决边界

- **已核实原文**：PM-Bench、Remember When It Matters、Drift No More、Lost in the Middle、FlipFlop 的 arXiv HTML；Anthropic context engineering；Pydantic AI SystemReminders/TrajectoryJudge 官方文档。指定来源均访问成功，无未核实项。
- **已只读映射**：内部事件总线 两份既有研究、当前 Wake 架构及指定四份 内部知识库 文档；未修改 内部知识库。
- **未验证**：未复现论文、未运行真实多 Pi/token 实验、未验证本仓 compact/resume 注入实现与缓存行为，也未证明现有 Wake 的有效或无效。
- **剩余风险**：合成基准与真实编码/写作协作差距、模型版本漂移、提醒引起过度行动、外部记忆陈旧和第二模型成本/隐私。本文不形成默认参数或功能实施承诺。
- **变更收口**：仅新增本研究文档；无代码、测试、协议、skill、living 文档或 内部知识库 修改，不 commit/push。
