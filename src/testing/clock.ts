/** 显式 fake clock；没有 timer，推进时不会自动调用 core。 */
import { integer } from "../core/validation.js";

/** 只允许单调非负安全整数时钟。 */
export interface FakeClock {
  /** 读取当前显式时间。 */
  now(): number;
  /** 前进指定毫秒数；拒绝溢出。 */
  advance(milliseconds: number): number;
  /** 设置不小于当前值的时刻。 */
  set(now: number): number;
}

/** 创建独立时钟；单独推进不代表任何 lifecycle 或投递发生。 */
export function createFakeClock(initial = 0): FakeClock {
  integer(initial, "initial");
  let current = initial;
  const set = (now: number) => {
    integer(now, "now");
    if (now < current) throw new RangeError("clock moved backwards");
    current = now;
    return current;
  };
  return { now: () => current, set, advance(milliseconds) {
    integer(milliseconds, "milliseconds");
    return set(current + milliseconds);
  } };
}
