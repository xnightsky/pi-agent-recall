/** 输入校验只处理数据，不调用 getter、宿主或隐式时钟。 */

/** 校验无访问器、无未知字段的普通数据对象。 */
export function object(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(name + " must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(name + " must be plain data");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key)) throw new TypeError(name + " unknown field " + String(key));
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (descriptor.get || descriptor.set) throw new TypeError(name + "." + key + " must not be an accessor");
    if (!descriptor.enumerable) throw new TypeError(name + "." + key + " must be enumerable data");
  }
  return value as Record<string, unknown>;
}

/** 校验非空有界字符串，不修改调用者数据。 */
export function text(value: unknown, name: string, max = 256): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new TypeError(name + " must be a bounded nonempty string");
}

/** 校验有限、非负、安全整数；不接受 NaN、无穷或小数。 */
export function integer(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(name + " must be a safe integer >= " + min);
}

/** 校验显式枚举值，未知不自动降为 false。 */
export function member<T>(value: unknown, values: readonly T[], name: string): asserts value is T {
  if (!values.includes(value as T)) throw new TypeError(name + " has an unsupported value");
}

/** 安全相加截止时间，饱和到最大安全整数而不溢出。 */
export function until(now: number, duration: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, now + duration);
}

/** 先检查数组描述符再复制值；禁止 getter、额外字段、空洞和自定义迭代器。 */
export function array(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(name + " must be a plain data array");
  const length = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
  integer(length, name + ".length", 0, max);
  if (Reflect.ownKeys(value).length !== length + 1) throw new TypeError(name + " array has extra fields or holes");
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) throw new TypeError(name + " array has holes");
    if (descriptor.get || descriptor.set) throw new TypeError(name + " array must not contain an accessor");
    if (!descriptor.enumerable) throw new TypeError(name + " array items must be enumerable data");
    result.push(descriptor.value);
  }
  return result;
}
