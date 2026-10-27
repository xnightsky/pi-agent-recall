---
type: spec
date: 2026-10-26
status: 待书面评审，未实施
---
# 配置层设计：工具双段（配置段 + 召回段）；CLI 与落盘配置端已冻结

## 1. 目的、确认范围与状态

召回层已随阶段一完成：`/core` 决策内核、`/testing` 回放、`/pi` adapter 的 reanchor/wake 同步投递链路均有测试与真实 PTY 证据。本规格定义其上的**配置层**——对[策略与配置 §11](../architecture/policy-and-configuration.md#11-当前可执行的策略操作)既有 SDK 操作的双入口管理外壳。

用户已确认的分层（2026-10-26 修订）：

- **工具层只暴露 2 个工具**：`recall_read`（读）与 `recall_write`（写，action 路由）；配置段与召回段是读写载荷的结构，不是工具数量（用户 2026-10-26 确认，借鉴 pi-intercom 单工具 action 形态）。
- **CLI 层与落盘配置端：设计冻结**。不做持久化即无冷事实源，CLI 失去影响会话的通道，仅剩 validate/replay/trace 离线壳，不值得建 bin 入口；冻结不等于删除，设计资产与解冻条件见[附录 A](#附录-a已冻结的-cli-与落盘配置端)。

本文件是供用户评审的设计提案，不是已实现接口。书面批准前不实施；实施时以失败测试先行。**注意**：[2026-10-25 补全规格](2026-10-25-deterministic-policy-core-design.md)写有「暂停 Pi adapter、Tool、Skill 的实现」，adapter 已另行落地；本规格的工具层与该条款正面冲突，**批准本规格即视为书面解除该条款对工具层的限制**，补全规格本身的策略定义提案不受影响。

## 2. 事实源与写路径

不引入 broker、daemon、持久化配置文件或文件监听。唯一事实源在会话内：

```text
wrapper extension 代码（初始 AttentionConfig，人编辑）
  │  session_start 时 createPiRecallExtension 读入
  ▼
内存配置端（会话内 PolicyCore 实例）
     模型工具唯一写路径：core.applyConfig（原子替换、推进 revision、旧票据作废）
```

- 工具改内存配置只影响**当前**会话；会话结束即失效，无回写（冻结期内无落盘端可写）。
- 「人授权 emit」通道：编辑 wrapper 代码中的配置（现状）；将来可加人敲的 `/recall-mode` slash 命令（registerCommand），均不需要落盘文件。
- 运行态观测（账本、trace）仍由 wrapper 显式落盘 trace 文件；冻结期内由 replay/读文件等手工方式消费。

## 3. CLI 配置段（已冻结）

整节设计移入[附录 A](#附录-a已冻结的-cli-与落盘配置端)，冻结期内不实施、不建 bin 入口。

## 3. 工具面：一读一写（主，会话内）

借鉴 pi-intercom 的单工具 action 路由形态：只注册 **2 个工具**，配置段与召回段是读写载荷里的结构，不是工具数量。经 `pi.registerTool(defineTool(...))` 注册，TypeBox 判别联合 schema 编译期收口：

### 3.1 `recall_read`（只读）

无参数。返回 `{ config, recall }` 两个英文分区键的全量无正文观测面：

| 分区键 | 内容 | 来源 |
|---|---|---|
| `config` | 生效 mode/profile id 与来源、fence 六元组、real vs shadow 账本、最近抑制原因 | `getState()` |
| `recall` | 当前锚点元数据（ref/version/sizeBytes/expiresAt）与最近一次投递结果 | adapter 快照；默认不含正文，正文透出与否由 wrapper 显式配置 |

### 3.2 `recall_write`（写）

`action` 判别联合路由，每个 action 的参数面独立收口：

| action | 参数 | 写路径与边界 |
|---|---|---|
| `"configure"` | `mode: "off" \| "shadow"`、有界数值（dedupeMs/cooldownMs/预算/TTL，上下限写死在 schema） | 合并进 override 后 `applyConfig`；**schema 枚举里没有 emit——模型可降噪不可自我解禁**；开 emit 只能人改 wrapper 配置代码（或将来 slash 命令） |
| `"acknowledge"` | 无 | 确认收到当前锚点版本，落带 fence 归因的无正文 trace；**弱证据**：只能由消费者折算进后续候选的 `evidenceCount`；core 的 `adoption:"unobserved"` 不变量不动 |
| `"refresh"` | 无 | 声明锚点过时，adapter 通知 AnchorProvider 升版本；升版后按正常门槛评估，dedupe/cooldown 不被绕过 |

安全不对称是编译期性质，不是 prompt 叮嘱：升级方向（→emit）在工具层不存在参数面；未知 action 或非法参数在 schema 层与 execute 内双重拒绝，返回 `isError` 而不抛向宿主。

证据作弊防护：`acknowledge`/`refresh` 的调用记录带 fence 与版本归因，replay 可审计；「模型声称忘了」不允许折算为 evidence（沿用既有规则）。

## 5. 与既有契约的关系

- core 零改动：本层全部长在 adapter（`src/pi`）内；`PolicyCore` 接口、`adoption:"unobserved"`、fence/投递不变量均不变。
- [§6 字段所有权](../architecture/policy-and-configuration.md#6-字段所有权与覆盖权限)：工具只触碰「允许配置的生效参数」，不触碰规则结构、宿主事实伪造或安全门槛。
- [§11](../architecture/policy-and-configuration.md#11-当前可执行的策略操作) 的 CLI/Tool 空缺标注在本层落地后需更新。
- 与待评审补全规格正交：它不引入 Policy 定义、规则 DSL 或提案生成；`policyVersion` 仍是匹配与归因字符串。

## 6. 验证方案（批准后）

1. 单测：fake ExtensionAPI 捕获 `registerTool` 定义恰好 2 个；驱动 execute 走通三个 action 与 read 全路径；schema 无 emit、未知 action 拒绝为编译期与运行期双重断言；非法参数整体拒绝。
2. PTY：扩展 `tests/integration/pi-recall.ittest.ts` 场景组——真实 Pi 中模型经假端点脚本化调用工具的场景（零 token），核对 trace 行为。
3. 仍不证明：模型采用率与净收益（属独立的 `*.token.ittest.ts` 实验）。

## 7. 非目标

broker/daemon/网络监听/文件热监听；配置自动标定；模型 Tool 注册表通用化；跨会话配置同步；自然语言策略条件；任何形式的「模型自我解禁 emit」参数面。**冻结期内追加**：持久化配置文件、CLI bin 入口、配置命名空间管理。

## 附录 A：已冻结的 CLI 与落盘配置端

冻结原因（2026-10-26 用户确认）：不做持久化即无冷事实源；CLI 仅剩离线壳，价值不足以建 bin 入口。以下设计资产在需求出现时解冻评审。

### A.1 落盘配置端命名空间（冻结）

一旦持久化，作用域即一等公民；级联镜像 core 已有的 conservative → profile → override 解析链：

```text
全局  <agentDir>/recall.config.json          （所有项目默认）
项目  <cwd>/.pi/recall.config.json          （项目级，可版本管理/review）
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
