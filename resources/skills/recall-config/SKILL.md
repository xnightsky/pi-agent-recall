---
name: recall-config
description: pi-agent-recall 召回层的有界配置手册。当收到 recall config-hint 消息（重复抑制、missing-anchor 等）或用户要求调整召回打扰频率/模式时加载；你只拥有 configure 白名单（shadow/off 与数值参数），emit 由人类决定。
---

# recall-config：召回层有界配置手册

你被召回是因为 adapter 感知到配置相关状态（config-hint 消息里有当前 mode/profile/抑制原因/锚点版本）。
你的唯一写面是 `recall` 工具的 `configure` action。按本手册诊断并调用；不要臆造参数。

## 抑制原因解读表

| config-hint 中的 reason | 含义 | 建议动作 |
|---|---|---|
| `duplicate` | 同一锚点版本在去重窗口内重复投递 | 若内容确实更新慢，调大 `dedupeMs`；否则不动 |
| `cooldown` | 距上次投递太近 | 调大 `cooldownMs` 降低打扰；或不动 |
| `budget-exceeded` | 本 epoch 尝试预算耗尽 | **不要**自行调大 `maxAttemptsPerEpoch`；提示人类检查预算策略 |
| `missing-anchor` | AnchorProvider 无当前锚点 | configure 解决不了；提示人类检查 AnchorProvider 接线 |
| `action-disabled` | profile 关闭了该动作 | 由人类决定，不要自行打开 |
| `off` / `unknown-state` | 上下文未命中任何 profile，默认静默 | **不要**动作；告知人类当前上下文未配置 |

## configure 参数面（白名单，除此之外一律被拒绝）

- `mode`: 仅 `"shadow"` 或 `"off"`——`"emit"` 对你结构性不可用，那是人类的决定。
- `allowReanchor` / `allowWake`: 布尔。
- `cooldownMs` / `dedupeMs` / `maxAttemptsPerEpoch`: 有限正数。
- 每次调用至少携带一个键；未知键整体拒绝。

## 禁项

- 不得编造或夸大 evidence：acknowledge 只是弱证据，不是你用来证明自己「记住了」的通道。
- 不得为了消除 config-hint 而把所有数值调到最大；目标是打扰与收益的 balance。
- 每次 configure 都会落带 fence 归因的审计 trace，人类可经 replay 复盘你的每次调整。
- shadow 的观察结论不等于真实收益；不要向人类承诺净收益。
