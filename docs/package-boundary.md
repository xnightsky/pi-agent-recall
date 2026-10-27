---
type: guide
---
# 包边界

- 单包，公开入口 `pi-agent-recall/core`、`pi-agent-recall/testing` 与 `pi-agent-recall/pi`；另开放 package.json 元数据。无包根默认入口。
- ESM JS+d.ts 构建到 dist，Node >=22；runtime dependencies 为零。core 不依赖 Pi、事件总线、内部知识库、Node 文件/网络 API。
- `src/pi` 经 `/pi` 公开真实 adapter；私有深层导入仍被拒绝，不将内部模块作为稳定 API。
- 消费者拥有锚点内容和可信大小/版本；宿主拥有 lifecycle/timer/同步投递；组合根提供唯一 session owner/runtime incarnation。
- 无 judge、daemon、scheduler、registry、memory bank、共享 Todo、离线队列或 durable 补发。
- 两类 contract fixture、真实双消费者接入、Pi canary 和 token A/B 是不同验证层，不能互相冒充。
- npm `private:true`，版本 `0.4.0-experimental.0`；查询名称未占用不等于名称保留或发布授权。本轮只做本地 pack/离线安装。
- 包内未声明开源许可证；研究引用不授予第三方代码/数据再分发权。不得因本地验证通过而 publish。
- tarball 包含 dist、resources（随包 skill）、README、docs，不包含源码测试、.tmp、凭据或宿主配置。进程证据与依赖缓存留在 .tmp。

开发测试另使用 `x-agent-suite` 与 `@x-agent-suite/pty-driver` **0.6.1** 同轮本地 tarball（仅 devDependencies，Node >=24）。当前依赖路径要求同级 suite 制品目录；未建立 registry/跨机器自动分发承诺。不会把 PTY 原生依赖或宿主 profile 放入 core/runtime，也不从 package exports 暴露测试胶水。
