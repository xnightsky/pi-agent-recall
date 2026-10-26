---
type: plan
date: 2026-10-25
status: 已完成（仅真实 TUI 载具）
---
# Pi 真实 PTY 的零费用测试载具

## 目标与停点

在已完成阶段零之后，独立验证真实 Pi 1.4.0 TUI → 本机 fake provider → 响应观测与清理。复用 x-agent-suite 0.6.1 公共制品，不改邻仓、不增加生产 `/pi` adapter、不声称模型 adopted 或完整 V2。

**[冲突提示]** suite 的 sandbox 仅隔离目录和部分环境，不是 OS 网络/文件边界；旧示例的环境剥离名单、整屏 prompt 回显及 close 返回不能独立证明安全或成功。先补本仓保护与客观断言，未通过安全前置条件不启动宿主。

## 依赖与范围

- 同轮本地制品：`本地制品目录/`，commit `<脱敏>`。按其公开分发约定以成对 file tarball devDependency 消费，固定 lockfile；这是要求兄弟目录布局的本地验证环境，不是可移植 registry 安装承诺。
- 核心 tgz SHA256：`79b5bddf65733f4bfd28fe4ad11abf91f76db880abb3cd39b5192c09b12db7ec`。
- PTY tgz SHA256：`c621bc1620b734ab8473a58191f6e905686d8aee912dd056f62fde53a73a5931`。
- 测试开发环境 Node >=24；不改变纯 core 的 Node >=22 契约。PTY 车道显式 opt-in，暂限支持网络限制探针的 macOS。
- `tests/support` 自持 Pi profile；只用公开 `x-agent-suite/contracts`、`x-agent-suite/llm-fixture`、`@x-agent-suite/pty-driver`。不深导入邻仓 fixture、不复制 driver。

## 可验证步骤

1. 安装现成已校验的制品；为默认 runner 排除完整 `.token.ittest.ts`、环境白名单、固定 loopback 与拒绝 live 配置写 RED 测试。
2. 实现最小 fixture profile：新 HOME/cwd/config，禁工具、MCP、扩展、技能、上下文文件、历史 session、自动包安装、重试/缓存预热/更新遥测；清除继承凭据、代理、Node 预加载等全部非白名单环境。临时工件限制在本仓 `.tmp`。
3. 先用非宿主 Node 子进程验证 OS 网络规则：仅允许本次 fake 端口，拒绝其他 loopback 端口与非 loopback 地址。平台/工具缺失显式 skip；策略解析、探针或已 opt-in 后的意外错误必须失败，禁止降级为无保护或 live。
4. 启动钉版本 Pi CLI，断言请求模型/正文/数量、仅响应出现的随机 marker，以及 close 后 HOME/cwd 删除。保存版本和证据，明确进程退出观测的覆盖范围。
5. reviewer 只读核验安全/证据口径；owner 复跑默认 `pnpm check` 与 opt-in 集成，更新测试文档和结果。

## 非目标与剩余门禁

本切口只验证真实 TUI 测试载具；不自动变成 recall 同步 sink、request-local reanchor、agent_end/settled、迟到回调、双消费者或生产迁移的证明。fake 固定响应不证明注意力改善。OS 网络限制也不宣称完整文件/进程沙箱。无 commit、push、publish、真实 provider 或模型费用。

## 实际结果与收口

- 现成制品 SHA256 与同轮 manifest 一致；本仓离线 `--ignore-scripts` 安装，公共 PTY import 成功，邻仓未修改。
- 单元测试 6 项已有失败→通过，覆盖 suffix 排除、环境/配置门禁、网络限制及 1.4.0 就绪判据；`pnpm check` 已 **50/50**，typecheck/build 通过。
- `E2E_PI_PTY=1 pnpm ittest` 已 **1/1**：一次 fake 请求，response-only 随机 marker，PID ESRCH，HOME/cwd 删除。默认车道 **0 pass / 1 skip**，keep-sandbox 负例明确失败。
- macOS SBPL 要求 `remote ip "localhost:<port>"`，不接受此处的 127.0.0.1 字面语法；URL 仍严格 IPv4 loopback。保护探针与宿主用同一策略文件。
- 真实 Pi 1.4.0 footer/横幅时序不同于旧示例，补回归后等待二者同时出现；不以延长 sleep 或放宽安全约束求绿。
- 运行证据在 `.tmp/pi-pty-evidence.json` 与 `.tmp/pi-pty-green.log`；完整覆盖与限制见[测试文档](../testing.md)。
- reviewer 定点只读复核 Critical/Important/Minor 均为 0；安装身份/SRI、已有 evidence、现场 PID/cwd 与纯断言/typecheck 为独立证据，真实宿主运行仍为 owner 证据。
- 最终再次执行 `pnpm check` **50/50** + typecheck/build，以及显式 PTY **1/1**；日志 `.tmp/check-with-pty-final.log`、`.tmp/pi-pty-final.log`。没有新增生产 adapter 或付费实验。
- 注释收口限新测试模块头、中文导出 JSDoc、环境/fixture/网络/后缀/清理不变量；core/testing 生产实现未改变，未改邻仓、未提交/推送/发布。
