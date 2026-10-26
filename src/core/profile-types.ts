/** 模型配置契约；键精确匹配，不根据名称推断能力。 */

/** 宿主、模型、任务及两种策略版本的完整归因键。 */
export interface ProfileContext {
  host: string;
  hostVersion: string;
  provider: string;
  model: string;
  modelRevision: string;
  taskFamily: string;
  roleTopology: string;
  policyVersion: string;
  reminderTextVersion: string;
}

/** 有界策略参数；时间单位为毫秒，计数为非负安全整数。 */
export interface PolicySettings {
  mode: "off" | "shadow" | "emit";
  allowReanchor: boolean;
  allowWake: boolean;
  minEvidence: number;
  dedupeMs: number;
  cooldownMs: number;
  wakeCooldownMs: number;
  maxAttemptsPerEpoch: number;
  maxWakePerEpoch: number;
  reservationTtlMs: number;
  wakeTtlMs: number;
  maxPending: number;
  maxDedupeEntries: number;
  maxLogEntries: number;
  maxAnchorBytes: number;
}

/** 离线发布的精确 profile；不允许运行时动态执行配置。 */
export interface AttentionProfile {
  id: string;
  context: ProfileContext;
  settings: Partial<PolicySettings>;
}

/** 整体替换的配置；override 撤回后恢复精确 profile 或保守默认。 */
export interface AttentionConfig {
  context: ProfileContext;
  profiles?: readonly AttentionProfile[];
  override?: Partial<PolicySettings>;
}

/** 已校验且与输入隔离的生效配置。 */
export interface ResolvedProfile {
  id: string;
  context: ProfileContext;
  source: "conservative" | "profile" | "user";
  settings: PolicySettings;
}
