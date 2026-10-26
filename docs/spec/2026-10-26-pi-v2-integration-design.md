---
type: spec
date: 2026-10-26
status: 测试 adapter 已实施，生产提升待评审
---
# Pi V2 宿主集成设计：测试先行并预留生产

## 1. 目的与授权边界

本设计把当前真实 Pi PTY 传输载具扩展为 recall 宿主集成验证，使真实 Pi 在 sandbox 与固定假端点中加载测试 adapter，验证 request-local reanchor、settled 后 wake、continuation、提交前失效及迟到回调。所有 V2 验证零真实 token。

用户已选择“测试先行并预留生产”：下一实施阶段可以设计并实现真实 adapter 与组合根，但只由测试夹具显式加载，不提前公开 `/pi`，不承诺生产可用。本文件批准的是书面设计评审入口；实施仍须在本 spec 评审通过后编写并评审实施计划。

本设计不授权生产迁移、发布、真实 provider、付费 A/B、模型效果声明或相邻仓修改。

## 2. 当前证据与缺口

当前 `tests/integration/pi-pty.ittest.ts` 只证明：钉版 Pi 1.4.0 能启动，经 loopback 假端点完成一次请求，响应 marker 出现在真实 PTY，且进程退出、目录清理和网络门禁有效。它没有加载 recall，不能证明锚点注入、生命周期事实、投递边界或模型采用。

Pi 1.4.0 的扩展契约提供两个关键同步边界：

- `context` 在一次 LLM 调用前变换消息；变换是请求级的，不需要写入会话条目。
- `agent_before_settle` 在最终结算前返回 entries 与 `continue: true`，可请求一次 continuation。
- `agent_end` 后仍可能有 retry、recovery、compaction 或 queued work，不能当作最终 idle。
- `agent_settled` 是 notification-only，不能承担本次 wake 触发。
- `--no-extensions` 不禁止显式 `--extension`，因此可禁用所有发现扩展并只加载测试 adapter。

这些能力来自当前安装版本的扩展文档与导出类型。实施时仍须用真实宿主测试证明实际事件顺序和返回结果被接受，不能只凭类型声明宣布 V2 通过。

## 3. 方案选择

### 3.1 采用：事件返回值作为同步 sink

reanchor 使用 `context` 返回请求级消息变换；wake 使用 `agent_before_settle` 返回追加消息和一次 continuation。`prepareDelivery` 与本地 sink 草稿构造之间不 `await`、不排队、不调用异步发送接口。

该方案与 core 的同步投递边界最一致，并可用 fake backend 检查真实 provider 请求。

### 3.2 不采用：sendUserMessage

`sendUserMessage()` 是发送或排队接口，不能精确表达本次同步接受、失败与 unknown，也容易混入 steer/followUp 语义。它不作为 V2 wake sink。

### 3.3 不采用：provider payload 或嵌套模型调用

`before_provider_request` 过于依赖具体协议；`modelRegistry` 嵌套调用绕开正常 agent 生命周期。两者都会削弱 continuation、会话归因和请求局部性，不作为本阶段主路径。

## 4. 模块与所有权

```text
src/core/                     保持宿主无关，不导入 Pi
src/pi/                       真实 adapter 与组合根；暂不加入 package exports
tests/support/                可控 AnchorProvider、场景驱动、故障包装与证据记录
tests/integration/            真实 Pi + sandbox + fake provider 的 V2 测试
```

- `src/pi/` 是实际实现，不是预留空目录或空 `/pi` 导出。只有测试夹具显式加载它。
- adapter 的模块接口按未来生产候选保持清晰，但只实现 V2 所需能力，不提前增加生产配置体系或无用抽象。
- 每个 extension runtime 持有一个 core 和一个 emit owner；宿主侧生成唯一 incarnation。core 不新增随机数、registry 或全局 owner 发现。
- 同一组合根拥有 evaluate、prepare、sink 和 commit；测试不创建第二条可绕过 core 的投递路径。
- 若测试发现 core 缺陷，先用公共 core 接口补失败测试并最小修复，不在 adapter 中绕过安全门槛。

### 4.1 AnchorProvider 与快照

消费者继续拥有 AnchorProvider。V2 测试使用同步、确定性的内存快照，至少包含 ref、version、正文和可选 expiry。adapter 每次 prepare 前重新读取完整快照，并用真实 UTF-8 编码计算 sizeBytes。

正文只存在于 adapter 的当前快照和 outbound 草稿；core 的候选、状态与日志仍只接收无正文元数据。版本改变、删除、到期或超过大小上限时不得回退旧正文。

生产 AnchorProvider 的发现、存储与跨消费者仲裁不在本阶段实现。

## 5. 运行状态与来源分类

组合根维护当前 runtime、当前 run 来源和捕获 fence。普通用户 run 标记为 `external`；由 recall wake 产生、带专用 customType 的 run 标记为 `attention`，不得再次触发召回。

- `input`、真实工具活动及真实 session/tree/compaction 变化可按 external lifecycle 处理。
- 正常的 `agent_start`、`turn_start` 是同一外部 run 的内部阶段，不得被误记为新 activity 而重开预算。
- `agent_end` 不等于 settled，不据此产生 wake。
- reload 与 session replacement 关闭旧 runtime；旧闭包和旧回执即使迟到，也只能得到 closed/stale。
- 新 runtime 使用新 incarnation，不从旧 getState 恢复预算、去重或许可。

具体事件去重与映射在 adapter 单元测试中固定，避免同一事实被多个通知重复推进 epoch。

## 6. Reanchor 数据流

```text
before_agent_start
  捕获 run 来源、fence、锚点引用和当前事实
  evaluate 生成 reservation
        ↓
context
  同步重读完整快照与当前事实
  prepareDelivery 复核 fence、版本、期限、能力和账本
        ↓
  只在本次 outbound messages 的本地草稿中加入锚点
  commitDelivery(submitted)
  返回草稿
```

reanchor 不使用 `appendEntry`、`sendMessage` 或持久会话消息。后续普通请求不得携带旧锚点。

这里的 `submitted` 仅表示 adapter 已在当前同步调用中完成请求级变换草稿，下一步将把它返回 Pi；不表示 Pi 已接受、provider 已收到、模型已采用或任务完成。provider 请求由 fake backend 独立举证。

Pi 在 handler 返回之后是否接受结果，adapter 无法完整观测；这一宿主盲区必须保留在证据解释中，不能把回执写成网络确认。

## 7. Wake 数据流

只在 `agent_before_settle` 评估 wake，至少要求：

- `outcome === "completed"`；
- 当前 `event.continue === false`；
- 没有 pending messages；
- 当前锚点、证据、能力和全部 core 门槛有效。

```text
agent_before_settle
  evaluate + 同步重读快照 + prepareDelivery
        ↓
  构造 custom_message entry + continue:true 的本地结果
  commitDelivery(submitted)
  返回 boundary result
```

这里的 `submitted` 表示 adapter 已生成附带锚点且 `continue: true` 的 boundary result 草稿，下一步将把它返回 Pi；不表示 Pi 已接受 continuation 或额外推理已经成功。wake custom message 可成为 Pi 会话条目；只有 reanchor 承诺请求级非持久。

已有 continuation、pending message 或 aborted/error outcome 时不得 wake。`canContinue` 是追加草稿前的上下文状态；最终为 assistant 时可以为 false，追加 custom message 后形成可运行上下文，不能把它误当前置授权门槛。recall 自己触发的 custom run 不得再次 wake，总请求数必须有精确上限。

## 8. 同步投递与错误语义

- prepare 前重新读取快照、事实与 fence；prepare 与本地 sink 草稿构造之间不 `await`。
- 不在许可后缓存、跨 config/session/activity 转换或复用 permit。
- 同步 sink 明确拒绝时记 failed；无法判明时记 unknown；均不退款、不自动重试。
- 投递异常不得静默吞掉。记录无正文诊断，并让本次召回 fail closed；原始用户请求不应被测试 adapter 无故阻断。
- handler 返回之后的宿主接受、provider 网络结果和模型采用不属于当前 submitted 证据。
- 后续 handler 可能继续组合 boundary 结果；V2 隔离环境只加载受控 handler。生产兼容性不在本阶段冒充已解决。

自然事件无法制造的提交前竞争，可以通过测试侧包装 AnchorProvider、sink 或生命周期端口进行 fault-injection。故障钩子不进入生产候选配置，证据必须明确标注为注入竞争，不冒充自然竞态复现。

## 9. 测试分层与门禁

### 9.1 单元测试

使用 fake ExtensionAPI 和同步假端口验证：

- run 来源分类与 external/attention 映射；
- 快照重读、UTF-8 字节数和正文不进入 core；
- reanchor/wake 结果构造及 fail-closed 分支；
- failed/unknown 不退款、不自动重试；
- reload/session replacement 后旧 runtime 与回调失活；
- fault-injection 下版本、activity 和 config 变化被 prepare 拒绝。

这些测试不启动真实 Pi，归入 `*.test.ts` 和默认 `pnpm test`。

### 9.2 真实 Pi 集成测试

新增 `tests/integration/pi-pty-recall.ittest.ts` 或按职责拆分的同后缀文件，沿用 `E2E_PI_PTY=1 pnpm ittest`、钉版 Pi、sandbox、假端点和临时根清理。默认 `pnpm ittest` 必须明确 skip，不得加载付费测试。

| 场景 | 必过断言 |
| --- | --- |
| 显式加载身份 | `-ne -e <测试 adapter>` 只加载指定扩展，留下 runtime/incarnation 证据 |
| reanchor 正向 | 目标 provider 请求包含随机锚点 marker，且只出现一次 |
| reanchor 非持久 | 后续普通请求不含旧 marker，不产生额外 wake |
| 锚点版本变化 | prepare 拒绝，请求不含旧正文，不记 submitted |
| 提交前失效 | 注入 activity/config 变化后旧 reservation 不投递 |
| wake 正向 | settled 且无 continuation 时恰好增加一次含 wake marker 的请求 |
| 已有 continuation | continue=true 或有 pending message 时不 wake、不附锚点 |
| 自激抑制 | recall custom run 不再次 wake，精确请求数不增长 |
| off/缺锚点/未知事实 | 原请求不变，不含 marker，不增加 run |
| failed/unknown | 不退款、不自动重试，后续请求不放大投递 |
| reload/session 迟到回调 | 旧 prepare/commit 无效，不出现迟到 marker |
| 清理与网络 | PID 退出、目录删除、非 fixture 网络拒绝、零真实 token |

### 9.3 反假通过规则

1. 每个场景使用独立随机 marker；响应 marker 不得预先出现在提示词中。
2. 同时检查 fake backend 原始请求、adapter 无正文事件轨迹和 PTY 结果，不只看屏幕文本。
3. 断言精确请求次数与每个请求的消息内容。
4. 正向用例必须有 off 或不加载 recall 的对照，证明锚点来自 adapter。
5. adapter 未加载、扩展异常、证据缺失、请求数不符或清理失败必须失败，不能转 skip。
6. 只有平台、Node、钉版 Pi/suite 或 sandbox 前置缺失允许 skip；启用后的解析、网络、PTY、断言错误一律失败。
7. fault-injection 与自然事件证据分开报告。
8. 文档中的通过数量以当次 runner 输出为准，不把 skip 写成通过。

## 10. 验收与生产提升边界

V2 完成的最低证据是：adapter 单元门禁通过，上述真实 Pi 场景在显式零 token 集成车道通过，主审与独立 reviewer 能复核请求级证据，且 docs 明确区分 adapter submitted、provider 请求和模型采用。

当前真实 PTY 已覆盖 8 个场景；reload/session 迟到回调仍只有单元失活验证，未形成独立真实 PTY 场景，不宣称该矩阵全部完成。即使后续全部通过，也只证明钉版宿主上的受控集成机制，不证明生产可用或模型净收益。

公开 `/pi` 前必须另行评审：

- 真实 AnchorProvider、配置和迁移路径；
- 多消费者事实来源与唯一 emit owner；
- 与其他扩展的 handler 组合和宿主版本兼容；
- 移除测试 fault hooks 后的故障处理与观测；
- package exports、安装、升级和回滚契约。

真实双消费者效果、付费模型 A/B、采用率、任务结果、token/latency/cache 与删除实验继续属于后续独立门禁。

## 11. 文档与实施约束

实施前须在本 spec 评审通过后编写施工计划。新行为先写失败测试；公共 core 契约如需变化，必须重新读取并同步架构文档，不借 V2 暗中扩大 core 职责。

实施时同步更新架构总览、决策链路、包边界、使用教程和测试门禁中受影响的实现状态。过程证据写入 `.tmp/`；不在文档中硬编码未经当次验证的数量，不提交、发布或写远程，除非另获明确授权。
