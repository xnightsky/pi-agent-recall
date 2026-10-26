/** testing 公共入口；仅显式 fake 与回放，不连接真实宿主、provider 或墙钟。 */
/** 显式时钟及其契约。 */
export { createFakeClock } from "./clock.js";
export type { FakeClock } from "./clock.js";
/** 同步假宿主及提交记录。 */
export { createFakeSink } from "./sink.js";
export type { FakeSink, FakeSubmission } from "./sink.js";
/** 使用公共 core 的确定性回放。 */
export { replay } from "./replay.js";
export type { ReplayEvent, ReplayObservation, ReplayResult } from "./replay.js";
