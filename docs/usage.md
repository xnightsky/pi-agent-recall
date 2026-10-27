---
type: guide
---
# 使用教程：从 shadow 到有界 fake 投递

本教程只使用当前已实现的 `/core`、`/testing` 公开接口。不连接 Pi、不调用真实模型、不需要 API key，也不会生成真实 token 费用。

当前只有一套固定动作逻辑。下文配置的是它的参数与开关，不是创建 `reanchor-only` 等尚未实现的命名策略。整体关系见[策略与配置](architecture/policy-and-configuration.md)。

## 1. 先运行完整示例

### 环境与安装

- 已构建 core 的运行要求为 Node >=22。
- 在本仓安装开发依赖、构建和运行默认测试，需要 Node >=24、pnpm 10.33.0。
- 开发依赖还需要同级 x-agent-suite 的固定 0.6.1 tarball；先按[制品说明](plans/2026-10-25-pi-pty-fixture.md)核对身份与 SHA256，缺失时不要用不明版本替换。
- 包目前 private、未发布，不能按“已在 registry 发布的 Pi 插件”安装。

在仓库根目录运行；已安装依赖时可跳过 install：

```sh
pnpm install
pnpm build
node docs/examples/core-walkthrough.mjs
```

[完整可运行示例](examples/core-walkthrough.mjs)含行为断言，正常输出：

```text
tutorial:shadow
tutorial:stale-fence
tutorial:anchor-changed
tutorial:submitted
tutorial:duplicate
tutorial:withdraw-off
tutorial:replay
tutorial-walkthrough-ok
```

这些标记分别证明模拟、旧事件失效、版本复核、fake 回执、去重、撤回配置和确定性回放。submitted 仅是 fake 提交结果，不证明真实注入或模型采用。

下面逐步解释示例中的操作。代码片段共享完整示例中的变量与辅助函数；独立执行请使用上面的完整文件，而不是只复制一段。

## 2. 选择要演示的行为

默认 mode=off，不会提醒。建议先用 shadow，再考虑 emit：

| 目标 | mode | allowReanchor | allowWake |
|---|---|---|---|
| 只看决策，不产生许可 | shadow | 按需要 | 按需要 |
| 只借已有请求重锚定 | emit | true | false |
| 重锚定优先，停后才可能 wake | emit | true | true |
| 只允许停后 wake | emit | false | true |
| 关闭干预 | off | 不影响 off 结果 | 不影响 off 结果 |

wake 还需要宿主明确证明无下一请求、settled、无 continuation，并提供有效锚点、证据和能力。开关为 true 不是自动唤醒命令；已有请求但 reanchor 关闭时仍沉默，不升级为 wake。

完整示例只演示 reanchor，wake=false。预算和时间数值仅供可重复的教学实验，不是已标定的生产推荐。

## 3. 创建实例并确认默认关闭

```js
import { randomUUID } from "node:crypto";
import { createPolicyCore, resolveProfile } from "pi-agent-recall/core";

const core = createPolicyCore({
  scope: "tutorial-session",
  owner: "tutorial-owner",
  incarnation: randomUUID(),
});
console.log(core.getState().profile.settings.mode); // off
```

- scope 表示当前会话范围，owner 由宿主组合根明确指定。
- 每个真实 runtime 必须使用唯一 incarnation；示例在 core 外调用 randomUUID，不给纯 core 添加随机数依赖。
- 同 session 只能有一个 emit owner；其他消费者提供候选/锚点，不各自发送。
- 真实替换实例时先 close 旧实例，再为新实例分配新 incarnation，不能把 getState 当作恢复接口。

## 4. 准备完整上下文与参数方案

完整示例使用虚构环境，避免暗示任何模型已经得到标定：

```js
const context = {
  host: "tutorial", hostVersion: "1", provider: "fixture", model: "fake",
  modelRevision: "1", taskFamily: "tutorial", roleTopology: "single",
  policyVersion: "fixed-example-1", reminderTextVersion: "text-1",
};
const baseConfig = {
  context,
  profiles: [{
    id: "tutorial-parameters",
    context,
    settings: {
      allowReanchor: true, allowWake: false, cooldownMs: 0, dedupeMs: 1_000,
      reservationTtlMs: 100, maxAttemptsPerEpoch: 1,
    },
  }],
};
```

Profile 必须按完整 context 精确匹配；只改 model 或其他任一键，不会自动继承。未知组合默认 off，不能从模型名字推断能力。

这里的 Profile 没有设置 mode，因此仍默认 off；后续通过显式 override 选择 shadow 或 emit。当前 policyVersion 只是匹配与归因字符串，不会加载策略代码。

## 5. 先预览参数，再应用 shadow

```js
const config = { ...baseConfig, override: { mode: "shadow" } };
const preview = resolveProfile(config);
console.log(preview.id, preview.source, preview.settings.mode);
// tutorial-parameters user shadow
core.applyConfig(config);
```

resolveProfile 是纯解析，不修改 core。applyConfig 则整体替换配置并推进 revision，取消旧预留/许可；非法配置整体拒绝。

当前 source 是整体来源摘要，不是逐字段来源。成功切配置也不会清真实次数、冷却或去重；不要为了每次 evaluate 反复 applyConfig。

## 6. 提供当前锚点与一次真实来源的候选

消费者拥有完整快照；core 只能看到元数据。示例按实际 UTF-8 字节数计算大小：

```js
function metadata(snapshot) {
  return {
    ref: snapshot.ref,
    version: snapshot.version,
    sizeBytes: new TextEncoder().encode(snapshot.content).byteLength,
  };
}
```

如果来源提供 expiry，也应将 expiresAt 放入元数据。正文必须与 version 一致，不能把旧正文和新版本拼在一起。

完整示例的 captureNewEvent 在“模拟一个新外部事件”时构造：

```js
const candidate = {
  fence: core.getState().fence,
  anchor: anchor.ref,
  facts: {
    nextRequest: "available", activity: "active", continuation: "present",
    evidenceCount: 1,
    capabilities: { reanchor: true, wake: false },
  },
  observedAt: now,
  provenance: "external",
};
const decision = core.evaluate({ candidate, anchor, now });
```

这些事实全部来自可控 fixture，不是 core 对 Pi 的实际观察。真实消费者必须提供可复算证据；“模型似乎忘了”不能充当 evidenceCount。

fence 必须在事件发生时捕获。旧 callback 保留旧输入，不能在执行时重取最新 fence 来冒充新事件。now 是单调非负安全整数毫秒，不是隐式系统时钟。

## 7. 读懂 shadow 结果

本例条件有效，所以 evaluate 返回：

```js
{ kind: "silent", reason: "shadow", disposition: "drop", wouldAction: "reanchor" }
```

检查 getState 时：

- real.attempts 为 0，shadow.attempts 为 1。
- 不会产生真实 reservation 或 permit，fake sink 调用次数也为 0。
- 日志使用 action=reanchor、reason=shadow，不能统计成 submitted。
- wouldAction 位于 evaluate 返回值；日志不是同名字段。
- adoption 与 cost 始终 unobserved。

shadow 从独立零账本模拟，不是沿用真实预算的精确反事实。单独推进 fake clock 或读取状态，都不触发到期清理。

## 8. 切到 emit：先验证旧候选失效

```js
core.applyConfig({ ...baseConfig, override: { mode: "emit" } });
console.log(core.evaluate(shadowInput).reason); // stale-fence
```

这一步必须用 shadow 阶段保留的原输入，才能演示旧事件被拒绝。正确路径是等待/模拟一个新外部事件，再构造新候选，不是给旧输入替换 fence。

切 emit 不补发 shadow 历史。emit 的 evaluate 也只返回 reservation，并不发送、不计真实尝试；真正计尝试发生在 prepare 成功时。

## 9. 先演示版本变化被拒绝，再做 fake 投递

完整示例先用 version=1 评估并预留，然后把消费者快照更新为 version=2。prepare 重新读取 v2 后返回：

```js
{ status: "rejected", reason: "anchor-changed" }
```

此时 sink 没有被调用、真实尝试仍为 0。不得偷偷使用旧正文或改写预留；必须重新产生候选并 evaluate。

### 用当前 v2 重新评估

新候选得到 reservation 后，再次同步读取当前快照与事实，进入以下边界：

```js
sink.setResult("submitted"); // 仅预设 fake 行为，不是实际投递
const latest = readCurrentSnapshot();
const ready = core.prepareDelivery(decision.reservation.id, {
  fence: core.getState().fence,
  anchor: metadata(latest),
  facts: currentFacts(),
  now: clock.now(),
});
if (ready.status !== "ready") {
  throw new Error("投递前复核被拒绝：" + ready.reason);
}
// 此处不 await、不重入配置或生命周期。
const result = sink.submit(ready.permit);
const receipt = core.commitDelivery(ready.permit, result, clock.now());
```

fake sink 只记录许可和模拟结果，不会消费正文或注入真实请求。实际宿主组合根必须用同一当前快照，将正文投递到正确位置。Pi 宿主可直接使用公开的 `pi-agent-recall/pi` 入口（`createPiRecallExtension`）；生产 AnchorProvider 由消费者实现，模型效果仍未验证。

prepare 成功已保守计一次尝试。同步提交明确拒绝才记 failed；不确定则 unknown。failed/unknown 不退款、不自动重试，commit 不能接受 adopted。

完整示例还验证：

- 重复提交同一个回执返回 duplicate，不重复记账。
- 再评估相同 ref@version 会被去重，不会再次调用 sink。
- receipt 幂等只在有界保留窗口内有效，不是永久 exactly-once。

## 10. 撤回覆盖、处理生命周期与关闭

撤回覆盖不是传空增量，而是重新提供不含 override 的完整配置：

```js
core.applyConfig(baseConfig);
console.log(core.getState().profile.settings.mode); // off
```

本例 Profile 没有开启 mode，所以回到 off。其他项目若精确 Profile 自身设置了 mode，则恢复该 Profile，而非保证总为 off。

activity/session/reload 需要事件发生时捕获的 fence 和 external 来源。完整示例用一次真实来源的 activity 演示：阶段计数可以重置，但仍在有效期内的去重不清除；这不是任意清空预算的接口。

结束实例时调用 core.close()。旧实例永久失活，getState 仍可诊断；新的真实实例必须使用新 incarnation。

## 11. 回放事件并比较配置

完整示例先从模拟记录实例捕获输入，再构造 replay 事件：

```js
const events = [{
  kind: "evaluate",
  input,
  delivery: {
    input: {
      fence: input.candidate.fence,
      anchor: input.anchor,
      facts: input.candidate.facts,
      now: 0,
    },
    result: "submitted",
  },
}];
const result = replay(options, events);
```

- 有 delivery 且通过 prepare，才执行同步 fake sink 和 commit；仅 evaluate 不自动模拟投递。
- 事件可包含 config、transition、close，最多 10,000 步；不会补 fence、建立 timer 或自动重试。
- 相同 options 与事件产生相同结果，完整示例用 deepEqual 实际断言。
- 把同一历史输入在 shadow 配置下回放，提交次数为 0；emit 方案的 fake 提交为 1。
- 回放中的历史 incarnation 是模拟身份，不是线上恢复许可；真实新 runtime 仍须使用唯一新身份。
- 比较的是动作、抑制、预算和 fake 回执，不是模型采用率、真实 token 成本或最佳 Profile。

## 12. 常见结果与排查

| 结果或现象 | 优先检查 | 不要这样修 |
|---|---|---|
| off | 是否默认关闭、Profile 是否全键匹配、是否撤回 override | 按模型名字自动开启 |
| stale-fence | 是否发生配置/会话/reload/activity 变化，或旧实例回调迟到 | 给旧事件补最新 fence |
| missing-anchor / anchor-changed | 当前快照是否缺失、ref/version 是否变化 | 回退旧正文或篡改预留 |
| insufficient-evidence | 证据是否有效、阈值是否满足 | 用主观“忘记了”填计数 |
| unknown-state / no-opportunity | 当前请求、活动、continuation 是否明确 | 把 unknown 当成 none |
| unsupported / action-disabled | 宿主能力、动作开关、当前机会类型 | reanchor 不可用就改 wake |
| reserved / duplicate | 是否已有预留，或相同 ref@version 仍在去重窗口 | 盲目重试或换假版本 |
| cooldown / wake-cooldown / budget | 是否达到冷却或次数上限 | 切配置/模式假装清账 |
| pending-capacity / dedupe-capacity | 未完成项和有效去重是否占满容量 | 驱逐仍有效项来绕过 |
| expired / stale-reservation | deadline、expiry、TTL 或配置失效是否发生 | 缓存旧许可、自动补发 |
| 推进 fake clock 后状态未清理 | 是否有下一次携 now 的 core 调用 | 把 fake clock 当 timer |
| 根入口或深路径导入失败 | 是否只使用公开 /core、/testing、/pi | 绕过 exports 深导入 |

## 13. 本地消费与验证

在其他本地项目消费时，先在本仓构建并打包：

```sh
pnpm build
pnpm pack --pack-destination .tmp/package
```

将生成的 tarball 复制到消费者自己的 vendor 目录，再在消费者目录运行：

```sh
pnpm add ./vendor/pi-agent-recall-0.4.0-experimental.0.tgz
```

这不是 registry 发布，也不需要 publish。仅使用 pi-agent-recall/core、pi-agent-recall/testing 与 pi-agent-recall/pi；TypeScript 消费者使用支持 ESM 的模块设置，例如 NodeNext。详细边界见[包边界](package-boundary.md)。

在本仓验证：

```sh
node docs/examples/core-walkthrough.mjs
pnpm check
```

示例也进入了真实 tarball 离线消费测试：不是只检查 Markdown 文字，而是在已安装包内用 Node 执行全部断言。该验证仍是零 token 单元测试，不证明真实 Pi 的同步投递、注入位置或模型收益，详见[验证门禁](testing.md)。
