/** 纯核心公共入口；不读取宿主、文件或网络。 */
export { resolveProfile } from "./profile.js";
/** 配置与精确归因类型。 */
export type { AttentionConfig, AttentionProfile, PolicySettings, ProfileContext, ResolvedProfile } from "./profile-types.js";
/** 无正文候选、动作与投递契约。 */
export type * from "./contracts.js";
/** 生命周期和诊断契约。 */
export type * from "./runtime-types.js";
/** 会话局部纯核心工厂。 */
export { createPolicyCore } from "./policy-core.js";
