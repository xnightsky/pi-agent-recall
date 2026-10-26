---
type: spec
date: 2026-10-25
status: 实施依据
---
# 最终命名与 runtime 契约补充

本文件补充[阶段零设计](2026-10-25-phase-zero.md)，冲突处以本文件为准。保留原 dated 正文，不把候选命名过程改写成最新事实。

## 最终命名与初始化

用户最终确认目录与 npm 包均为 `pi-agent-recall`。创建前目标 sibling 不存在，npm registry 返回 404；查询不是名称保留。先前 `pi-attention` 的 npm 名已存在，未复用；本人初建目录已安全迁移，没有覆盖其他仓。

公开入口为 `pi-agent-recall/core`、`pi-agent-recall/testing`。定位是模型注意力召回策略，动作仍为 silent/reanchor/wake；Pi 是首个生态，core 保持宿主无关。本轮没有 Pi adapter，不恢复已暂停的事件召回旧方案。

已独立 git init，沿用 AGENTS/AGENTS.ai/gitignore 与单包 TypeScript 模板。Git user 仅按用户要求配置在本仓本地，不修改全局配置；用户身份不写进可发布文件。本轮无 commit、remote 或发布授权。

## 跨实例生命周期

`createPolicyCore({ scope, owner, incarnation, config? })` 要求组合根提供每个 runtime 唯一的非空 incarnation；core 不使用随机数、全局 registry 或外部 I/O。incarnation 进入 candidate fence、reservation、permit 与 receipt 关联，不能只使用从 1 开始的本地计数。

同一实例分配 revision/generation/epoch；新 runtime 必须使用新 incarnation，并 close 旧实例。close 清除预留并使旧实例 evaluate/prepare 等操作失活，不能靠取消 timer 的成功与否证明安全。状态读取仍可用于诊断。

activity/session transition 必须携带捕获的完整 fence 和来源；旧 callback 或 attention 来源不能重开 epoch/预算。真实外部活动允许，activity 不清 cooldown/去重；新 session incarnation 不承诺恢复旧预算。

## 单次投递边界

先由组合层同步获取当前完整锚点快照并计算可信元数据，再调用 prepare。prepare 不仅检查 fence、版本、expiry、活动、能力，还重新检查全部当前可变预算、冷却和去重门槛。

prepare 同一 id 至多一次返回 permit。成功即保守记录尝试；permit 必须紧邻同步宿主提交调用使用，中间不得 await、缓存或跨 config/session/activity 转换。该时序是组合根契约，不是 core 对外部副作用的强制仲裁能力。

submitted/failed/unknown 回执只能记录真实可观察结果；failed/unknown 不退款、不自动重试。重复同结果回执幂等，冲突结果显式错误。待回执项也有截止时间；没有结果最终记 unknown，不退款。已完成 receipt 只在有界保留窗口内幂等；淘汰或过期 id 返回 stale，不重新记账或重建 permit。

## shadow 与可观测边界

shadow 从独立的零账本开始做模拟，不宣称是沿用当前 emit 已使用预算的精确反事实；切模式丢弃模拟候选和模拟账本，真实账本保持。模拟动作不能变成 submitted/adopted。

引用键使用结构化编码，避免 provider/id/version 的分隔符碰撞；各字符串有长度上限，日志限制不只有条数。默认日志不含正文或敏感任意 facts。

## 验收补充

两次同 scope/owner 的不同 incarnation、旧实例 close、双 anchor 竞争 cap/cooldown、prepare 重复调用、pending 无回执超时、幂等保留淘汰、旧 callback 调 transition、自激与真实 activity 交错都通过公共接口测试。

真实 Pi canary、双消费者 shadow 和模型效果实验仍是后续门禁；core 数量与宿主数量本身不是删除判据，删除实验看净收益以及移除 core 后共享决策复杂度是否重新散落到消费者。
