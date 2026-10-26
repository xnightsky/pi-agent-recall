/**
 * 当前公开接口的零 token 教程；仅使用内存快照、fake clock 和同步 fake sink。
 * 不变量：正文不进入 core；事件当时捕获 fence；prepare→sink 不 await；不连接真实宿主。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPolicyCore, resolveProfile } from "pi-agent-recall/core";
import { createFakeClock, createFakeSink, replay } from "pi-agent-recall/testing";

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
const clock = createFakeClock(0);
const sink = createFakeSink();
let current = {
  ref: { provider: "rules", id: "current" },
  version: "1",
  content: "先读取当前约束，再执行任务。",
};

function readCurrentSnapshot() {
  return structuredClone(current);
}

function metadata(snapshot) {
  return {
    ref: snapshot.ref,
    version: snapshot.version,
    sizeBytes: new TextEncoder().encode(snapshot.content).byteLength,
  };
}

function currentFacts() {
  return {
    nextRequest: "available", activity: "active", continuation: "present",
    evidenceCount: 1, capabilities: { reanchor: true, wake: false },
  };
}

// 只模拟新外部事件；旧 callback 必须保留旧输入，不能重新调用此函数换 fence。
function captureNewEvent(core, snapshot, now) {
  const anchor = metadata(snapshot);
  return {
    candidate: {
      fence: core.getState().fence,
      anchor: anchor.ref,
      facts: currentFacts(),
      observedAt: now,
      provenance: "external",
    },
    anchor,
    now,
  };
}

function demonstrateShadow(core) {
  const config = { ...baseConfig, override: { mode: "shadow" } };
  const preview = resolveProfile(config);
  assert.equal(preview.id, "tutorial-parameters");
  assert.equal(preview.settings.mode, "shadow");
  core.applyConfig(config);
  const input = captureNewEvent(core, readCurrentSnapshot(), clock.now());
  const decision = core.evaluate(input);
  assert.equal(decision.kind, "silent");
  assert.equal(decision.reason, "shadow");
  assert.equal(decision.wouldAction, "reanchor");
  assert.equal(core.getState().real.attempts, 0);
  assert.equal(core.getState().shadow.attempts, 1);
  assert.equal(sink.getCalls().length, 0);
  console.log("tutorial:shadow");
  return input;
}

function switchToEmit(core, oldInput) {
  core.applyConfig({ ...baseConfig, override: { mode: "emit" } });
  assert.equal(core.evaluate(oldInput).reason, "stale-fence");
  console.log("tutorial:stale-fence");
}

function rejectChangedAnchor(core) {
  const input = captureNewEvent(core, readCurrentSnapshot(), clock.now());
  const decision = core.evaluate(input);
  assert.equal(decision.kind, "reanchor");
  current = { ...current, version: "2", content: "先校验当前版本，再准备投递。" };
  const latest = readCurrentSnapshot();
  const result = core.prepareDelivery(decision.reservation.id, {
    fence: core.getState().fence, anchor: metadata(latest),
    facts: currentFacts(), now: clock.now(),
  });
  assert.deepEqual(result, { status: "rejected", reason: "anchor-changed" });
  assert.equal(core.getState().real.attempts, 0);
  assert.equal(sink.getCalls().length, 0);
  console.log("tutorial:anchor-changed");
}

function deliverCurrentAnchor(core) {
  const input = captureNewEvent(core, readCurrentSnapshot(), clock.now());
  const decision = core.evaluate(input);
  assert.equal(decision.kind, "reanchor");
  sink.setResult("submitted");
  const latest = readCurrentSnapshot();
  const ready = core.prepareDelivery(decision.reservation.id, {
    fence: core.getState().fence, anchor: metadata(latest),
    facts: currentFacts(), now: clock.now(),
  });
  assert.equal(ready.status, "ready");
  // 此同步边界内不 await、不触发配置或生命周期变化；fake sink 不代表实际注入。
  const result = sink.submit(ready.permit);
  assert.equal(core.commitDelivery(ready.permit, result, clock.now()).status, "recorded");
  assert.equal(core.getState().real.attempts, 1);
  assert.equal(sink.getCalls().length, 1);
  assert.equal(core.commitDelivery(ready.permit, result, clock.now()).status, "duplicate");
  console.log("tutorial:submitted");
  const duplicate = core.evaluate(captureNewEvent(core, latest, clock.now()));
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(sink.getCalls().length, 1);
  console.log("tutorial:duplicate");
}

function demonstrateWithdrawal(core) {
  clock.advance(1);
  const event = {
    kind: "activity", fence: core.getState().fence,
    provenance: "external", now: clock.now(),
  };
  assert.equal(core.transition(event).status, "applied");
  assert.equal(core.getState().real.attempts, 0);
  const repeated = core.evaluate(captureNewEvent(core, readCurrentSnapshot(), clock.now()));
  assert.equal(repeated.reason, "duplicate");
  core.applyConfig(baseConfig);
  assert.equal(core.getState().profile.settings.mode, "off");
  assert.equal(core.getState().profile.id, "tutorial-parameters");
  console.log("tutorial:withdraw-off");
  core.close();
  assert.equal(core.getState().active, false);
}

function demonstrateReplay() {
  const options = {
    scope: "tutorial-replay", owner: "tutorial-owner", incarnation: randomUUID(),
    config: { ...baseConfig, override: { mode: "emit" } },
  };
  const recording = createPolicyCore(options);
  const input = captureNewEvent(recording, readCurrentSnapshot(), 0);
  recording.close();
  const events = [{
    kind: "evaluate", input, delivery: {
      input: {
        fence: input.candidate.fence, anchor: input.anchor,
        facts: input.candidate.facts, now: 0,
      },
      result: "submitted",
    },
  }];
  // replay 模拟同一历史身份，不是在线重建；真实重建必须分配新的 incarnation。
  const first = replay(options, events);
  assert.equal(first.submissions.length, 1);
  assert.equal(first.state.real.attempts, 1);
  assert.deepEqual(replay(options, events), first);
  const shadow = replay({
    ...options, config: { ...baseConfig, override: { mode: "shadow" } },
  }, events);
  assert.equal(shadow.submissions.length, 0);
  assert.equal(shadow.state.real.attempts, 0);
  assert.equal(shadow.state.shadow.attempts, 1);
  console.log("tutorial:replay");
}

const core = createPolicyCore({
  scope: "tutorial-session", owner: "tutorial-owner", incarnation: randomUUID(),
});
assert.equal(core.getState().profile.settings.mode, "off");
const shadowInput = demonstrateShadow(core);
switchToEmit(core, shadowInput);
rejectChangedAnchor(core);
deliverCurrentAnchor(core);
demonstrateWithdrawal(core);
demonstrateReplay();
console.log("tutorial-walkthrough-ok");
