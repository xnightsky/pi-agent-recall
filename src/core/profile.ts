/** 精确 profile 解析；整份校验成功前不产生任何运行态改变。 */
import type { AttentionConfig, PolicySettings, ProfileContext, ResolvedProfile } from "./profile-types.js";
import { array, integer, member, object, text } from "./validation.js";

const contextKeys = ["host", "hostVersion", "provider", "model", "modelRevision",
  "taskFamily", "roleTopology", "policyVersion", "reminderTextVersion"] as const;

const conservative: PolicySettings = {
  mode: "off", allowReanchor: true, allowWake: false, minEvidence: 1,
  dedupeMs: 60_000, cooldownMs: 1_000, wakeCooldownMs: 60_000,
  maxAttemptsPerEpoch: 1, maxWakePerEpoch: 1, reservationTtlMs: 5_000,
  wakeTtlMs: 5_000, maxPending: 16, maxDedupeEntries: 128,
  maxLogEntries: 128, maxAnchorBytes: 4_096,
};

function context(value: unknown): ProfileContext {
  const data = object(value, "context", contextKeys);
  for (const key of contextKeys) text(data[key], "context." + key, 128);
  return { ...data } as unknown as ProfileContext;
}

function patch(value: unknown): Partial<PolicySettings> {
  const data = object(value, "settings", Object.keys(conservative));
  for (const [key, value] of Object.entries(data)) {
    if (key === "mode") member(value, ["off", "shadow", "emit"], key);
    else if (key === "allowReanchor" || key === "allowWake") member(value, [true, false], key);
    else integer(value, key);
  }
  return { ...data } as Partial<PolicySettings>;
}

function settings(value: PolicySettings): PolicySettings {
  for (const key of ["maxPending", "maxDedupeEntries", "maxLogEntries"] as const) integer(value[key], key, 1, 10_000);
  for (const key of ["minEvidence", "reservationTtlMs", "wakeTtlMs", "maxAnchorBytes"] as const) integer(value[key], key, 1);
  if (value.maxWakePerEpoch > value.maxAttemptsPerEpoch) throw new RangeError("maxWakePerEpoch exceeds maxAttemptsPerEpoch");
  return value;
}

function identity(value: ProfileContext): string {
  return JSON.stringify(contextKeys.map(key => value[key]));
}

/** 精确匹配完整归因键，再应用用户覆盖；未知组合保持 off。 */
export function resolveProfile(config: AttentionConfig): ResolvedProfile {
  const data = object(config, "config", ["context", "profiles", "override"]);
  const current = context(data.context);
  const profiles = data.profiles === undefined ? [] : array(data.profiles, "profiles", 128);
  const seen = new Set<string>();
  let result: ResolvedProfile = { id: "conservative", context: current, source: "conservative", settings: { ...conservative } };
  for (const raw of profiles) {
    const profile = object(raw, "profile", ["id", "context", "settings"]);
    text(profile.id, "profile.id", 128);
    const key = identity(context(profile.context));
    if (seen.has(key)) throw new TypeError("duplicate profile context");
    seen.add(key);
    const parsed = settings({ ...conservative, ...patch(profile.settings) });
    if (key === identity(current)) result = { ...result, id: profile.id, source: "profile", settings: parsed };
  }
  if (data.override !== undefined) result = { ...result, source: "user", settings: settings({ ...result.settings, ...patch(data.override) }) };
  return result;
}
