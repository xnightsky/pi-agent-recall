/** 会话实例的公开诊断与调用契约；不暴露可变内部账本。 */
import type {
  ActionKind, AnchorMetadata, AttentionDecision, AttentionFacts, CommitResult,
  DeliveryPermit, DeliveryResult, EvaluateInput, PolicyFence, PrepareInput,
  PrepareResult, TransitionEvent, TransitionResult,
} from "./contracts.js";
import type { AttentionConfig, ResolvedProfile } from "./profile-types.js";

/** 一份真实或模拟账本的无正文诊断快照。 */
export interface LedgerState {
  attempts: number;
  wakeAttempts: number;
  lastAttemptAt: number | null;
  lastWakeAt: number | null;
  dedupeEntries: number;
}

/** 有界观测项；成本和采用在 core 内始终未观测。 */
export interface DecisionLog {
  at: number;
  event: "evaluate" | "prepare" | "commit" | "timeout";
  fence: PolicyFence;
  profile: ResolvedProfile;
  action: ActionKind | "silent";
  reason: string;
  anchor?: AnchorMetadata;
  facts?: AttentionFacts;
  delivery?: DeliveryResult;
  adoption: "unobserved";
  cost: "unobserved";
}

/** 可序列化快照；读取不驱动到期，不承诺恢复或跨进程同步。 */
export interface PolicyState {
  active: boolean;
  fence: PolicyFence;
  profile: ResolvedProfile;
  now: number;
  pendingReservations: number;
  pendingReceipts: number;
  retainedReceipts: number;
  real: LedgerState;
  shadow: LedgerState;
  logs: DecisionLog[];
}

/** 工厂参数；默认配置使用未知上下文的 conservative/off。 */
export interface PolicyCoreOptions {
  scope: string;
  owner: string;
  incarnation: string;
  config?: AttentionConfig;
}

/** 同 session 唯一 owner 的纯核心；外部副作用仍由组合根负责。 */
export interface PolicyCore {
  /** 评估候选并生成有界预留；不调用宿主。 */
  evaluate(input: EvaluateInput): AttentionDecision;
  /** 使用最新数据完整复核，同一预留至多签发一次许可。 */
  prepareDelivery(id: string, input: PrepareInput): PrepareResult;
  /** 记录同步投递结果；failed/unknown 不退款，不自动重试。 */
  commitDelivery(permit: DeliveryPermit, result: DeliveryResult, now: number): CommitResult;
  /** 校验后原子替换；保留真实账本，使旧 fence 失效。 */
  applyConfig(config: AttentionConfig): void;
  /** 仅当前 external transition 可以推进代次并重开阶段计数。 */
  transition(event: TransitionEvent): TransitionResult;
  /** 永久关闭该实例，旧回调不再有权决策。 */
  close(): void;
  /** 返回隔离诊断快照，不能以修改快照改变内部状态。 */
  getState(): PolicyState;
}
