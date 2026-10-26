/** 同步假宿主；不包含模型调用，不把 submitted 解释为 adopted。 */
import type { DeliveryPermit, DeliveryResult } from "../core/index.js";
import { copy, validatePermit } from "../core/input-validation.js";
import { member } from "../core/validation.js";

/** 一次 fake 提交及显式模拟结果。 */
export interface FakeSubmission { permit: DeliveryPermit; result: DeliveryResult }

/** 用于组合根契约测试的同步 sink，不替代真实宿主 canary。 */
export interface FakeSink {
  /** 设置后续同步调用的可观察结果。 */
  setResult(result: DeliveryResult): void;
  /** 模拟一次提交；默认 unknown，不偷偷宣称成功。 */
  submit(permit: DeliveryPermit): DeliveryResult;
  /** 返回隔离的调用记录。 */
  getCalls(): FakeSubmission[];
}

/** 构造默认 unknown 的同步 sink；结果必须由测试明确选择。 */
export function createFakeSink(): FakeSink {
  let result: DeliveryResult = "unknown";
  const calls: FakeSubmission[] = [];
  return {
    setResult(next) { member(next, ["submitted", "failed", "unknown"], "result"); result = next; },
    submit(permit) {
      validatePermit(permit);
      calls.push({ permit: copy(permit), result });
      return result;
    },
    getCalls: () => copy(calls),
  };
}
