# pi-agent-recall

面向 Pi agent 的注意力召回策略：**默认沉默，优先重锚定，必要时有界唤醒**。core 保持宿主无关，不拥有记忆库、业务 scheduler 或消息设施；一次投递不代表模型采用。

> `0.1.0-experimental.0`，`private:true`，仅本地实验，未发布。阶段零提供纯 `core/testing`，**不是可直接安装到 Pi 的生产扩展**。后续已实现 `src/pi` 测试 adapter，并在真实 Pi 1.4.0 的零费用 PTY 中验证 reanchor/wake；仍无公开 `/pi`、生产 adapter、双消费者迁移或模型效果验证。

**核心状态**：现有实现只有一套 Profile 参数化的固定动作逻辑，尚无命名策略或观察到提案的完整闭环。先读[架构总览](docs/architecture/README.md)和[策略与配置](docs/architecture/policy-and-configuration.md)了解支持范围与目标；具体[补全规格](docs/spec/2026-10-25-deterministic-policy-core-design.md)仍待书面评审、未实施；[Pi V2 设计](docs/spec/2026-10-26-pi-v2-integration-design.md)仅落实测试 adapter。

## 已实现的边界

- `pi-agent-recall/core`：精确 profile、conservative/off、用户覆盖/撤回、数据校验、完整生命周期 fence、决策和有界预留。
- `prepareDelivery` 完整复核，单次许可即计尝试；`commitDelivery` 区分 submitted/failed/unknown，有界幂等，失败不退款、不自动重试。
- `pi-agent-recall/testing`：显式 fake clock、同步 fake sink、确定性 replay；角色与规则双来源 contract fixture。
- shadow 从独立零账本模拟，外部始终 silent；切 emit 不补发，真实账本不因配置切换清零。
- `src/pi`：测试先行的同步 adapter 与组合根，仅供显式 fixture 加载，不进入 package exports。
- 零 runtime dependencies，ESM JS+d.ts；无公开 `/pi` 入口、网络、timer、全局 owner registry 或 core 正文存储。

## 开发与验证

纯 core 运行要求 Node >=22；当前开发测试依赖 x-agent-suite，需 Node >=24、pnpm 10.33.0，以及同级 `x-agent-suite/artifacts/0.6.1/` 成对固定制品。安装前核对 SHA256，见[载具计划](docs/plans/2026-10-25-pi-pty-fixture.md)。

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check
```

默认测试零 token，含真实 tarball 的本地离线安装和 JS+d.ts 消费（不启动宿主）。临时消费目录与缓存位于 `.tmp/`。构建产物位于 `dist/`，源码导入通过不等于包消费通过；详见[验证记录](docs/testing.md)。

```sh
pnpm ittest                  # 默认明确 skip 真实宿主用例
E2E_PI_PTY=1 pnpm ittest     # macOS + 已安装 Pi 1.4.0；假端点、OS 网络限制、零真实 token
```

当前 `pnpm check` **65/65**，显式 PTY **2/2**（原传输载具 + recall V2 场景组）。recall 场景组覆盖 8 个场景，证明受控 fixture 中的请求级 reanchor、单次 wake、continuation、版本/activity 失效和失败不重试；不证明生产可用或模型采用。reload/session 迟到回调仍只有单元失活验证。网络限制不等于完整文件/进程沙箱。

## 组合约束

消费者拥有当前 AnchorProvider 与正文，组合根提供唯一 session owner 和 runtime 唯一 incarnation。每次投递前重新取快照与事实；prepare 后必须紧邻同步 sink，期间不得 await、缓存许可或变更 lifecycle/config。旧实例必须 close。core 不替宿主强制此原子边界。

目前所有默认配置均为 off。行业榜单只能生成离线实验候选，不能证明本地干预净收益，也不能自动打开 wake 或设置“最佳”频率。

## 导航

- [文档地图](docs/README.md)
- [架构总览](docs/architecture/README.md)
- [策略支持与配置关系](docs/architecture/policy-and-configuration.md)
- [决策链路](docs/architecture/decision-flow.md)
- [确定性策略核心补全规格（待评审）](docs/spec/2026-10-25-deterministic-policy-core-design.md)
- [使用教程：shadow、fake 投递与回放](docs/usage.md)
- [零 token 可运行示例](docs/examples/core-walkthrough.mjs)
- [阶段实施计划](docs/plans/2026-10-25-phase-zero.md)
- [测试、真实宿主和删除实验门禁](docs/testing.md)
- [行业评分证据与离线标定](docs/research/2026-10-25-attention-scores-and-offline-calibration.md)

提交、发布、真实模型实验需要独立授权。本仓未提供开源许可证；本地验证通过不等于授权对外发布。
