---
type: spec
date: 2026-10-26
status: 待书面评审，未实施
---
# 配置层设计：CLI 配置段与工具双段（配置段 + 召回段）

## 1. 目的、确认范围与状态

召回层已随阶段一完成：`/core` 决策内核、`/testing` 回放、`/pi` adapter 的 reanchor/wake 同步投递链路均有测试与真实 PTY 证据。本规格定义其上的**配置层**——对[策略与配置 §11](../architecture/policy-and-configuration.md#11-当前可执行的策略操作)既有 SDK 操作的双入口管理外壳。

用户已确认的分层：

- **CLI 层只有一个配置段**：离线管理冷配置文件、回放与 trace 分析。
- **工具层有两段**：配置段（会话内热配置查询与有界调整）+ 召回段（模型侧的锚点观测与采用信号）。

本文件是供用户评审的设计提案，不是已实现接口。书面批准前不实施；实施时以失败测试先行。**注意**：[2026-10-25 补全规格](2026-10-25-deterministic-policy-core-design.md)写有「暂停 Pi adapter、Tool、Skill 的实现」，adapter 已另行落地；本规格的工具层与该条款正面冲突，**批准本规格即视为书面解除该条款对工具层的限制**，补全规格本身的策略定义提案不受影响。

## 2. 事实源与会师协议

不引入 broker、daemon、网络或文件监听。全部状态分两处，各有唯一写路径：

```text
冷配置（.pi/recall.config.json，消费者项目内）
  │  CLI 唯一写路径：recall config set（整份校验后才落盘）
  │  session_start 时 wrapper extension 读取
  ▼
热配置（会话内 PolicyCore 实例）
     工具唯一写路径：core.applyConfig（原子替换、推进 revision、旧票据作废）
```

- CLI 不连接、不发现、不唤醒任何活会话；改冷配置只影响**下一个** session_start。
- 工具改热配置只影响**当前**会话；是否回写冷配置文件由 wrapper 显式选择，默认不回写（会话内调整为临时行为）。
- 运行态观测（账本、trace）经 trace 落盘文件暴露；CLI `recall trace` 只读该文件。

## 3. CLI 配置段（辅助）

复用 `/core`、`/testing` 纯函数，shell 只做 I/O：

| 子命令 | 复用的既有纯函数 | 行为边界 |
|---|---|---|
| `recall config validate <file>` | `resolveProfile` | 整份校验并打印生效参数与来源；非法整体拒绝，不写盘 |
| `recall config set <file> <key> <value>` | `resolveProfile` | 只允许白名单数值/枚举键；改完重校验再落盘 |
| `recall replay <events.json> --config A [--config B]` | `replay` | 输出两侧动作/抑制/预算/fake 回执对比；不证明模型收益 |
| `recall trace <file>` | 无（只读格式化） | 汇总无正文 trace：各 reason 计数、real/shadow attempts |

非目标：不生成配置模板猜测模型能力；不做 `config init` 默认 emit；不与活会话交互。

## 4. 工具配置段（主，会话内）

经 `pi.registerTool(defineTool(...))` 注册，TypeBox schema 编译期收口：

| 工具 | 参数白名单 | 写路径与边界 |
|---|---|---|
| `recall_status` | 无 | 只读：`getState()` 的 fence、real/shadow 账本、最近抑制原因；不含正文 |
| `recall_config_set` | `mode: "off" \| "shadow"`、有界数值（dedupeMs/cooldownMs/预算/TTL，上下限写死在 schema） | 合并进 override 后 `applyConfig`；**schema 枚举里没有 emit——模型可降噪不可自我解禁**；开 emit 只能人走 CLI 改冷配置 |

安全不对称是编译期性质，不是 prompt 叮嘱：升级方向（→emit）在工具层不存在参数面。

## 5. 工具召回段（主，会话内）

让模型对召回链路有可观测、可请求的参与面，同时守住 core 不变量：

| 工具 | 行为 | 边界 |
|---|---|---|
| `recall_anchor_show` | 返回当前锚点**元数据**（ref/version/sizeBytes/expiresAt）与最近一次投递结果 | 默认不回正文；正文透出与否由 wrapper 显式配置 |
| `recall_acknowledge` | 模型显式确认收到当前锚点版本；adapter 记录为无正文 trace | **弱证据**：只能由消费者折算进后续候选的 `evidenceCount`；core 的 `adoption:"unobserved"` 不变量不动，core 不感知该信号来源 |
| `recall_refresh` | 模型声明锚点过时；adapter 通知 AnchorProvider 升版本 | 升版本后按正常门槛评估，不保证必然重锚定；dedupe/cooldown 不被此调用绕过 |

证据作弊防护：`acknowledge`/`refresh` 的调用记录带 fence 与版本归因，replay 可审计；「模型声称忘了」不允许折算为 evidence（沿用既有规则）。

## 6. 与既有契约的关系

- core 零改动：本层全部长在 adapter（`src/pi`）与新增 bin 壳内；`PolicyCore` 接口、`adoption:"unobserved"`、fence/投递不变量均不变。
- [§6 字段所有权](../architecture/policy-and-configuration.md#6-字段所有权与覆盖权限)：工具段只触碰「允许配置的生效参数」，不触碰规则结构、宿主事实伪造或安全门槛。
- [§11](../architecture/policy-and-configuration.md#11-当前可执行的策略操作) 的 CLI/Tool 空缺标注在本层落地后需更新。
- 与待评审补全规格正交：它不引入 Policy 定义、规则 DSL 或提案生成；`policyVersion` 仍是匹配与归因字符串。

## 7. 验证方案（批准后）

1. 单测：fake ExtensionAPI 捕获 `registerTool` 定义，驱动 execute 走通配置段/召回段全路径；schema 无 emit 为编译期断言；非法参数整体拒绝。
2. PTY：扩展 `tests/integration/pi-recall.ittest.ts` 场景组——真实 Pi 中模型经假端点脚本化调用工具的场景（零 token），核对 trace 与配置落盘行为。
3. 包契约：`bin` 入口进 tarball 离线消费测试。
4. 仍不证明：模型采用率与净收益（属独立的 `*.token.ittest.ts` 实验）。

## 8. 非目标

broker/daemon/网络监听/文件热监听；配置自动标定；模型 Tool 注册表通用化；跨会话配置同步；自然语言策略条件；任何形式的「模型自我解禁 emit」参数面。
