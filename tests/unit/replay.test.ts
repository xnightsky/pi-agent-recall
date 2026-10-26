import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../../src/testing/index.js";
import { anchor, config, facts, input, makeCore, prepare, reserve } from "../support/fixtures.js";

function testing() {
  const tools = api as Record<string, Function>;
  for (const name of ["createFakeClock", "createFakeSink", "replay"]) assert.equal(typeof tools[name], "function", name);
  return tools as Record<"createFakeClock" | "createFakeSink" | "replay", Function>;
}

test("fake clock 显式推进且不自动触发 core，拒绝倒退和溢出", () => {
  const { createFakeClock } = testing();
  const clock = createFakeClock(10);
  const core = makeCore({ reservationTtlMs: 5 });
  reserve(core, clock.now());
  assert.equal(clock.advance(5), 15);
  assert.equal(core.getState().pendingReservations, 1);
  core.evaluate(input(core, clock.now(), anchor("rules"), { evidenceCount: 0 }));
  assert.equal(core.getState().pendingReservations, 0);
  assert.throws(() => clock.set(14), /backwards/);
  assert.throws(() => clock.advance(-1), /safe integer/);
  assert.throws(() => createFakeClock(NaN), /safe integer/);
  clock.set(Number.MAX_SAFE_INTEGER);
  assert.throws(() => clock.advance(1), /safe integer/);
});

test("fake sink 控制三种回执且不伪造采用，所有结果均消耗真实尝试", () => {
  const { createFakeSink } = testing();
  for (const outcome of ["submitted", "failed", "unknown"] as const) {
    const core = makeCore();
    const sink = createFakeSink();
    sink.setResult(outcome);
    const ready = prepare(core, reserve(core).id);
    if (ready.status !== "ready") throw new Error("expected ready");
    const result = sink.submit(ready.permit);
    assert.equal(core.commitDelivery(ready.permit, result, 0).status, "recorded");
    assert.equal(core.getState().real.attempts, 1);
    assert.equal(core.getState().logs.at(-1)!.delivery, outcome);
    assert.equal(core.getState().logs.at(-1)!.adoption, "unobserved");
    const calls = sink.getCalls(); calls[0].permit.anchor.ref.id = "mutated";
    assert.equal(sink.getCalls()[0].permit.anchor.ref.id, "current");
    assert.throws(() => sink.setResult("adopted"), /unsupported/);
  }
});

test("双来源 replay 确定性，规则和角色共享 core；合法等待及机械负例沉默", () => {
  const { replay } = testing();
  const source = makeCore({ cooldownMs: 0 });
  const requests = [
    input(source, 0, anchor("roles")),
    input(source, 1, anchor("rules")),
    input(source, 2, anchor("roles", "waiting"), { nextRequest: "none", activity: "active" }),
    input(source, 3, anchor("rules", "mechanical"), { evidenceCount: 0 }),
  ];
  const events = requests.map(request => ({ kind: "evaluate", input: request, delivery: {
    input: { fence: request.candidate.fence, anchor: request.anchor!, facts: request.candidate.facts, now: request.now },
    result: "submitted",
  } }));
  const options = { scope: "session-a", owner: "owner", incarnation: "runtime-1", config: config({ cooldownMs: 0 }) };
  const original = structuredClone(events);
  const first = replay(options, events);
  assert.deepEqual(replay(options, events), first);
  assert.deepEqual(events, original);
  assert.deepEqual(first.events.map((row: any) => row.decision.kind), ["reanchor", "reanchor", "silent", "silent"]);
  assert.equal(first.submissions.length, 2);
  assert.equal(first.state.real.attempts, 2);
  assert.deepEqual(first.submissions.map((row: any) => row.permit.anchor.ref.provider), ["roles", "rules"]);
});

test("replay 的 shadow/off 不调用 sink；版本变化拒绝 prepare", () => {
  const { replay } = testing();
  const seed = makeCore();
  const request = input(seed);
  for (const mode of ["off", "shadow", "emit"] as const) {
    const result = replay({ scope: "session-a", owner: "owner", incarnation: "runtime-1", config: config({ mode }) }, [{
      kind: "evaluate", input: request, delivery: {
        input: { fence: request.candidate.fence, anchor: anchor("roles", "current", "v2"), facts: facts(), now: 0 },
        result: "submitted",
      },
    }]);
    assert.equal(result.submissions.length, 0);
    assert.equal(result.state.real.attempts, 0);
    if (mode === "emit") assert.equal(result.events[0].preparation.reason, "anchor-changed");
  }
});

test("replay 支持生命周期/配置、拒绝未知事件和缺失结果，不隐式重写 fence", () => {
  const { replay } = testing();
  const core = makeCore();
  const request = input(core);
  const options = { scope: "session-a", owner: "owner", incarnation: "runtime-1", config: config() };
  const result = replay(options, [
    { kind: "config", config: config({ mode: "off" }) },
    { kind: "evaluate", input: request },
    { kind: "close" },
  ]);
  assert.equal(result.events[1].decision.reason, "stale-fence");
  assert.equal(result.state.active, false);
  assert.throws(() => replay(options, [{ kind: "timer" }]), /unsupported/);
  assert.throws(() => replay(options, [{ kind: "evaluate", input: request, delivery: { input: { fence: request.candidate.fence, anchor: anchor(), facts: facts(), now: 0 } } }]), /unsupported/);
});
