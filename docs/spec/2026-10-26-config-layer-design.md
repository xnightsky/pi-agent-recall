---
type: spec
date: 2026-10-26
status: 已实施（2026-10-26 用户书面批准并解除旧规格工具暂停条款）
---
# 会话面设计：召回写工具、查看命令与触发链路

## 1. 目的、确认范围与状态

召回层已随阶段一完成：`/core` 决策内核、`/testing` 回放、`/pi` adapter 的 reanchor/wake 同步投递链路均有测试与真实 PTY 证据。本规格定义其上的**会话面**——三个维度，各归其位：

| 维度 | 形态 | 使用者 | 面 |
|---|---|---|---|
| 写操作 | 1 个工具 `recall` | 模型 | 召回信号（acknowledge/refresh）常驻；有界 `configure` 由 §9 的 skill 引导增补（待评审） |
| 查看 | 1 个 slash 命令 `/recall` | 人 | 机械只读：当前策略与状态视图，不可修改 |
| 触发 | adapter 提示词注入链路（已实现） | 自动 | 本规格 §5 用 TUI 线框图固化其外部可观测行为 |

用户已确认（2026-10-26 两次修订）：**CLI 层与落盘配置端设计冻结**（附录 A）；工具面收敛为单一召回写工具，配置查看移交 slash 命令。

本文件是供用户评审的设计提案，不是已实现接口。书面批准前不实施；实施时以失败测试先行。**注意**：[2026-10-25 补全规格](2026-10-25-deterministic-policy-core-design.md)写有「暂停 Pi adapter、Tool、Skill 的实现」，adapter 已另行落地；本规格的工具/命令与该条款正面冲突，**批准本规格即视为书面解除该条款对它们的限制**，补全规格本身的策略定义提案不受影响。

## 2. 事实源与写路径

不引入 broker、daemon、持久化配置文件或文件监听。唯一事实源在会话内：

```text
wrapper extension 代码（初始 AttentionConfig，人编辑）
  │  session_start 时 createPiRecallExtension 读入
  ▼
内存配置端（会话内 PolicyCore 实例）
     写路径：无会话内入口——配置变更只能人改代码重启会话
     （模型工具不触碰配置；/recall 只读）
```

「人授权 emit」通道：编辑 wrapper 配置代码；这是冻结期内唯一通道。

## 3. `recall`：模型唯一的召回写工具

经 `pi.registerTool(defineTool(...))` 注册，TypeBox 判别联合 schema 编译期收口：

| action | 参数 | 写路径与边界 |
|---|---|---|
| `"acknowledge"` | 无 | 确认收到当前锚点版本，落带 fence 归因的无正文 trace；**弱证据**：只能由消费者折算进后续候选的 `evidenceCount`；core 的 `adoption:"unobserved"` 不变量不动，core 不感知该信号来源 |
| `"refresh"` | 无 | 声明锚点过时，adapter 通知 AnchorProvider 升版本；升版后按正常门槛评估，dedupe/cooldown 不被绕过，不保证必然重锚定 |
| `"configure"`（§9 增补，待评审） | 白名单：`mode: "shadow"\|"off"`、allowReanchor/allowWake、cooldownMs/dedupeMs/maxAttemptsPerEpoch | 经 `applyConfig`；未知键/非法值整体拒绝；**schema 结构性无 emit** |

- 未知 action 在 schema 层与 execute 内双重拒绝，返回 `isError` 而不抛向宿主。
- 证据作弊防护：调用记录带 fence 与版本归因，replay 可审计；「模型声称忘了」不允许折算为 evidence（沿用既有规则）。
- ~~配置写面在模型侧整体不存在~~（§9 增补修订为：有界 `configure` 白名单，`emit` 在 schema 结构性缺席——模型永远无法自行打开真实投递，emit 仍人专属）。

## 4. `/recall`：人的机械只读查看命令

经 `pi.registerCommand` 注册；不接受参数、不修改任何状态，只在 TUI 渲染当前快照：

```text
/recall
┌─ recall ─────────────────────────────────────────────┐
│ mode: emit        profile: project-rules (profile)   │
│ fence: rev 3 · gen 1 · epoch 2   owner: wrapper-me   │
│ ledger: attempts 1 (wake 0) · shadow 0               │
│ last suppression: duplicate @rev 3                   │
│ anchor: file/AGENTS.md · v12 · 3.2 KB · 无 expiresAt │
│ last delivery: reanchor submitted · permit 9f2c      │
└──────────────────────────────────────────────────────┘
```

数据来源即 `getState()` 与 adapter 锚点快照元数据；**不渲染正文**。它是「机械查看策略」：看到什么就是 core 里实际生效的什么，无解释、无建议、无修改入口。

## 5. 触发链路：提示词注入与 TUI 可观测行为

召回的触发不是按钮，是 adapter 在两个宿主事件上的自动注入。线框图固化其外部可观测面（注入消息 `display:false`，**不进 TUI 渲染，只进 provider 请求**）：

```text
┌─ Pi TUI ──────────────────────────────────────────────┐
│ user: 帮我重构这个模块                                  │
│ ╌╌╌ reanchor 注入（TUI 不可见）╌╌╌                      │
│ assistant: 好的，先读取约束……                           │
│                                  ← 一轮正常 settle     │
│ ⣾ ……（wake：settle 边界被判为可续跑，自动再来一轮）      │
│ assistant: 补充：约束复核……                             │
└────────────────────────────────────────────────────────┘

触发链路（全部同步，无 await 跨边界）：

before_agent_start ── evaluate ──▶ 预留 reservation
context ── prepare 复核 ──▶ permit ──▶ 请求 messages 末尾追加锚块 ──▶ provider
                                        （reanchor：借已有请求，零额外轮次）

agent_before_settle ── evaluate ──▶ wake permit
      ──▶ entries:[wake 消息] + continue:true ──▶ 新一轮 before_agent_start
          （该轮 provenance=attention → evaluate 必然 self-trigger 沉默，
            不允许 wake 自己再续命；预算/冷却/去重照常记账）
```

人在会话内感知触发只有两个途径：settle 后多出来的那一轮 spinner（wake），以及 `/recall` 里的账本变化。模型感知触发只有两个途径：被注入的锚块内容，以及它自己 `recall` 的返回。

## 6. 与既有契约的关系

- core 零改动：本层全部长在 adapter（`src/pi`）内；`PolicyCore` 接口、`adoption:"unobserved"`、fence/投递不变量均不变。
- [§6 字段所有权](../architecture/policy-and-configuration.md#6-字段所有权与覆盖权限)：模型工具只产生召回段信号；配置参数连「允许配置的生效参数」也不向模型开放。
- [§11](../architecture/policy-and-configuration.md#11-当前可执行的策略操作) 的 CLI/Tool 空缺标注在本层落地后需更新。
- 与待评审补全规格正交：不引入 Policy 定义、规则 DSL 或提案生成；`policyVersion` 仍是匹配与归因字符串。

## 7. 验证方案（批准后）

1. 单测：fake ExtensionAPI 断言恰好注册 1 个 tool + 1 个 command；驱动 `recall` 两个 action 全路径；未知 action 双重拒绝；`/recall` 渲染输出为纯函数快照（注入 fake state 断言文本）。
2. PTY：扩展 `tests/integration/pi-recall.ittest.ts` 场景组——真实 Pi 中经假端点脚本化让模型调用 `recall`，核对 trace 与 fence 归因（零 token）。
3. 仍不证明：模型采用率与净收益（属独立的 `*.token.ittest.ts` 实验）。

## 8. 非目标

broker/daemon/网络监听/文件热监听；配置自动标定；**模型侧 emit 能力**；跨会话同步；自然语言策略条件；slash 命令的任何修改能力。**冻结期内追加**：持久化配置文件、CLI bin 入口、配置命名空间管理。

## 9. 增补（2026-10-26）：Skill 引导的配置闭环（待书面评审，未实施）

**定位：第四维——配置知识面。** `recall` 工具的 action 是能力，SKILL.md 是使用手册；模型平时只见 acknowledge/refresh 的常驻指引，仅当 adapter 感知到配置相关状态时才被召回配置手册，形成「感知 → 召回手册 → 按手册调用 configure → 审计 trace」闭环。

### 9.1 随包 Skill

- 位置 `resources/skills/recall-config/SKILL.md`，经 package.json `pi.skills` 声明与 `files` 随包分发；frontmatter `description` 写明何时加载（召回状态异常、重复抑制、锚点缺失）。
- 正文是抑制原因解读表：`duplicate` → 调 `dedupeMs`；`cooldown` → 调 `cooldownMs`；`budget-exceeded` → 提醒人类查预算；`missing-anchor` → 提醒人类查 AnchorProvider；`off` → 不动并提示由人类决定。附 configure 参数面与禁项：无 emit（schema 保证）、不得编造 evidence、每次调用落审计 trace。

### 9.2 感知与自动召回（adapter 侧，core 零改动）

- 触发（确定性规则，读 adapter 自己的 trace 流）：同一抑制 reason 连续 ≥2 次，或最近一次投递为 missing-anchor。
- 召回动作：在 `context` 事件追加 `display:false` 的 config-hint 消息——状态摘要（mode/profile/最近抑制计数/锚点版本）+「加载 skill recall-config 获取配置指引」。
- 频控：同一 reason 每 epoch 至多 1 次，每 incarnation 全局至多 3 次；每次落 trace event `"config-hint"`。
- 该注入**不走 core 预算**（不与 reanchor/wake 竞争投递通道），由 adapter 直接组装，与「core 不感知宿主」不变量一致。

### 9.3 configure action（有界，emit 结构性缺席）

参数白名单见 §3 表。schema 枚举无 `"emit"`，execute 内双重校验；未知键/非法值整体拒绝并 `isError`。每次调用落 trace event `"configure"`（applied/rejected + fence 归因）。acknowledge/refresh 语义不变。

### 9.4 验证方案（批准后）

1. 单测：configure 白名单路径与整体拒绝；config-hint 触发条件与频控上限；SKILL.md frontmatter 合法性（name/description）与内容不含正文锚点。
2. PTY：脚本化假端点——制造重复抑制 → 断言 config-hint 注入进入请求 → fixture 模拟模型读手册后调用 configure → 断言 trace 归因与生效参数；skill 目录经显式路径发现。
3. 仍不证明：模型是否真的会按手册行事（属 token 实验）。

### 9.5 边界修订

AGENTS.md「本仓无宿主 extension/skill，不复制下游技能」一行已随 `/pi` 公开过时；随本增补修订为：宿主 adapter 与随包 skill 由本仓维护（`src/pi`、`resources/skills`），不复制下游技能实例。

---


## 附录 A：已冻结的 CLI 与落盘配置端

冻结原因（2026-10-26 用户确认）：不做持久化即无冷事实源；CLI 仅剩离线壳，价值不足以建 bin 入口。以下设计资产在需求出现时解冻评审。

### A.1 落盘配置端命名空间（冻结）

一旦持久化，作用域即一等公民；级联镜像 core 已有的 conservative → profile → override 解析链：

```text
全局  <agentDir>/recall.config.json          （所有项目默认）
项目  <cwd>/.pi/recall.config.json           （项目级，可版本管理/review）
会话  <agentDir>/sessions/--<路径编码>/<时间戳>_<uuid>.recall.json
```

- 目录布局跟随 `PI_CODING_AGENT_DIR`（默认 `~/.pi/agent`）；Pi 1.4.0 真实 sessions 布局为 `sessions/--<路径编码>/<时间戳>_<uuid>.jsonl`，recall 会话级文件与之并列。
- 预置（session 开始前无 session id）只能落全局/项目级；会话级文件的真实价值是工具回写与会话恢复（resume）时配置跟随。
- emit 授权写哪一级需届时评审：建议人写项目级及以上；工具回写永远只写会话级且不含 emit。

### A.2 CLI 配置段子命令（冻结）

| 子命令 | 复用的既有纯函数 | 行为边界 |
|---|---|---|
| `recall config validate <file>` | `resolveProfile` | 整份校验并打印生效参数与来源；非法整体拒绝，不写盘 |
| `recall config set <file> <key> <value>` | `resolveProfile` | 只允许白名单数值/枚举键；改完重校验再落盘 |
| `recall replay <events.json> --config A [--config B]` | `replay` | 输出两侧动作/抑制/预算/fake 回执对比；不证明模型收益 |
| `recall trace <file>` | 无（只读格式化） | 汇总无正文 trace：各 reason 计数、real/shadow attempts |

### A.3 解冻条件

出现任一：需要跨会话保留配置调整；需要版本管理/review 配置；需要人会话外预置下次会话配置。解冻时本附录整体回到正文评审。
