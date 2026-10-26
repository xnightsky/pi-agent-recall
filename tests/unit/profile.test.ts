import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfile } from "../../src/core/index.js";

const context = {
  host: "fixture", hostVersion: "1", provider: "provider", model: "model",
  modelRevision: "1", taskFamily: "mechanical", roleTopology: "single",
  policyVersion: "policy-1", reminderTextVersion: "text-1",
};

test("默认 off；不将未知模型名解释为强弱", () => {
  const selected = resolveProfile({ context });
  assert.equal(selected.settings.mode, "off");
  assert.equal(selected.source, "conservative");
  assert.equal(resolveProfile({ context: { ...context, model: "super-strong" } }).settings.mode, "off");
});

test("profile 的每个键都必须精确匹配", () => {
  const profiles = [{ id: "calibrated", context, settings: { mode: "shadow" as const } }];
  assert.equal(resolveProfile({ context, profiles }).id, "calibrated");
  for (const key of Object.keys(context) as (keyof typeof context)[]) {
    const selected = resolveProfile({ context: { ...context, [key]: "different" }, profiles });
    assert.equal(selected.source, "conservative", key);
    assert.equal(selected.settings.mode, "off", key);
  }
});

test("显式用户覆盖优先且撤回恢复 profile；不修改输入", () => {
  const config = { context, profiles: [{ id: "calibrated", context, settings: { mode: "shadow" as const } }] };
  const before = structuredClone(config);
  const selected = resolveProfile({ ...config, override: { mode: "emit" } });
  assert.equal(selected.settings.mode, "emit");
  assert.equal(selected.source, "user");
  assert.equal(resolveProfile(config).settings.mode, "shadow");
  selected.context.model = "changed";
  assert.deepEqual(config, before);
});

test("非法字段、时长、计数和重复 profile 明确报错", () => {
  for (const value of [-1, NaN, Infinity, 0.5]) {
    assert.throws(() => resolveProfile({ context, override: { cooldownMs: value } }), /cooldownMs/);
  }
  for (const override of [{ mode: "enabled" }, { maxPending: 0 }, { maxWakePerEpoch: 5, maxAttemptsPerEpoch: 1 }, { surprise: true }]) {
    assert.throws(() => resolveProfile({ context, override } as never));
  }
  assert.throws(() => resolveProfile({ context: { ...context, model: "" } }), /model/);
  assert.throws(() => resolveProfile({ context, profiles: [
    { id: "a", context, settings: {} }, { id: "b", context, settings: {} },
  ] }), /duplicate/);
  assert.throws(() => resolveProfile({ context, override: { allowWake: true, wakeTtlMs: 0 } }), /wakeTtlMs/);
});

test("配置是数据，不接受函数、原型对象或未知上下文键", () => {
  assert.throws(() => resolveProfile({ context, override: { mode: () => "emit" } } as never));
  assert.throws(() => resolveProfile(new Date() as never));
  assert.throws(() => resolveProfile({ context: { ...context, secret: "not a fact" } } as never), /unknown/);
});
