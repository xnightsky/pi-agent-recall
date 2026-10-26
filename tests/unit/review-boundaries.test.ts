import assert from "node:assert/strict";
import test from "node:test";
import { createPolicyCore, resolveProfile } from "../../src/core/index.js";
import { replay } from "../../src/testing/index.js";
import { config, input, makeCore, prepare } from "../support/fixtures.js";

test("合法最大长度身份即使 JSON 转义扩张，core 仍能消费自己签发的预留", () => {
  const identity = "\u0000".repeat(255) + "x";
  const core = createPolicyCore({ scope: identity, owner: identity, incarnation: identity, config: config() });
  const decision = core.evaluate(input(core));
  assert.equal(decision.kind, "reanchor");
  if (!("reservation" in decision)) throw new Error("expected reservation");
  assert.equal(prepare(core, decision.reservation.id).status, "ready");
  assert.equal(core.getState().real.attempts, 1);
});

test("非 enumerable 数据在进入 runtime 前拒绝，不能丢 fence 后消耗预留", () => {
  const core = makeCore();
  const request = input(core);
  Object.defineProperty(request.candidate, "fence", { value: request.candidate.fence, enumerable: false });
  const before = core.getState();
  assert.throws(() => core.evaluate(request), /enumerable/);
  assert.deepEqual(core.getState(), before);
  const invalid = config();
  Object.defineProperty(invalid, "context", { value: invalid.context, enumerable: false });
  assert.throws(() => core.applyConfig(invalid), /enumerable/);
  assert.deepEqual(core.getState(), before);
});

test("profiles 数组禁止 getter、迭代器、空洞和 null，配置不执行代码", () => {
  const profile = { id: "bad", context: config().context, settings: { mode: "emit" } };
  let reads = 0;
  const accessor = [profile];
  Object.defineProperty(accessor, "0", { get() { reads++; return profile; } });
  assert.throws(() => resolveProfile({ context: config().context, profiles: accessor } as never), /accessor/);
  assert.equal(reads, 0);
  const iterable = [profile];
  Object.defineProperty(iterable, Symbol.iterator, { value: function* () { reads++; yield profile; } });
  assert.throws(() => resolveProfile({ context: config().context, profiles: iterable } as never), /array/);
  assert.equal(reads, 0);
  for (const profiles of [Array(1), null]) assert.throws(() => resolveProfile({ context: config().context, profiles } as never), /array/);
});

test("replay 同样在遍历前拒绝数组访问器与自定义 iterator", () => {
  const options = { scope: "s", owner: "o", incarnation: "i" };
  let reads = 0;
  const events = [{ kind: "close" }];
  Object.defineProperty(events, "0", { get() { reads++; return { kind: "close" }; } });
  assert.throws(() => replay(options, events as never), /accessor/);
  assert.equal(reads, 0);
  const iterable = [{ kind: "close" }];
  Object.defineProperty(iterable, Symbol.iterator, { value: function* () { reads++; yield { kind: "close" }; } });
  assert.throws(() => replay(options, iterable as never), /array/);
  assert.equal(reads, 0);
});
