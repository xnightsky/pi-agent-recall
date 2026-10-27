/** Pi adapter 公共入口；仅同步事件接线，不读取宿主凭据、文件或网络。 */
/** 锚点快照读取与可信元数据。 */
export { readAnchor } from "./anchor.js";
export type { PiAnchorRead } from "./anchor.js";
/** Pi 宿主结构契约。 */
export type * from "./host-types.js";
/** 同步 recall 投递内核。 */
export { createRecallRuntime } from "./recall-runtime.js";
export type { RecallRuntime, RecallRuntimeOptions, ReanchorResult, WakeResult } from "./recall-runtime.js";
/** 会话面：recall 信号工具与 /recall 只读命令。 */
export { executeRecallSignal, registerRecallSurface, renderRecallView } from "./surface.js";
export type { RecallSurfaceDeps } from "./surface.js";
/** Pi 事件组合根与唯一 session emit owner。 */
export { createPiRecallExtension } from "./extension.js";
export type { PiExtensionApi, PiRecallExtensionOptions, PiRecallTrace } from "./extension.js";
