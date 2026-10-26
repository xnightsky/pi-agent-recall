/** Pi 宿主结构类型；只描述本 adapter 使用的事件与消息，不引入运行时依赖。 */
import type { ActionKind, AnchorRef } from "../core/index.js";

/** 消费者一次同步读取的完整锚点快照。 */
export interface PiAnchorSnapshot {
  ref: AnchorRef;
  version: string;
  content: string;
  expiresAt?: number;
}

/** 消费者拥有的同步锚点来源；core 只接收其元数据。 */
export interface PiAnchorProvider { current(): PiAnchorSnapshot | undefined }

/** adapter 可追加到请求级上下文的无依赖消息结构。 */
export type PiMessage = Record<string, unknown>;

/** agent_before_settle 中用于 wake 判断的最小边界。 */
export interface PiSettleBoundary {
  outcome: "completed" | "aborted" | "error";
  continue: boolean;
  context: { pendingMessages: readonly unknown[]; canContinue: boolean; contextMessages?: readonly PiMessage[] };
}

/** wake 追加的会话消息草稿。 */
export interface PiWakeEntry {
  type: "custom_message";
  customType: "pi-agent-recall.wake.v1";
  content: string;
  display: false;
}

/** 返回给 Pi 的最终结算结果。 */
export interface PiBoundaryResult { entries: PiWakeEntry[]; continue: true }

/** 同步宿主草稿接收边界；失败必须显式抛出。 */
export interface PiDeliverySink { accept(action: ActionKind): void }
