/** 锚点快照读取；正文留在 adapter，core 仅获得隔离元数据。 */
import type { AnchorMetadata } from "../core/index.js";
import type { PiAnchorProvider, PiAnchorSnapshot } from "./host-types.js";

/** 同一快照及其可信元数据。 */
export interface PiAnchorRead { snapshot: PiAnchorSnapshot; metadata: AnchorMetadata }

/** 同步读取一次完整快照，计算 UTF-8 字节数并隔离外部修改。 */
export function readAnchor(provider: PiAnchorProvider): PiAnchorRead | undefined {
  const current = provider.current();
  if (!current) return undefined;
  const snapshot: PiAnchorSnapshot = { ...current, ref: { ...current.ref } };
  const metadata: AnchorMetadata = {
    ref: { ...snapshot.ref }, version: snapshot.version,
    sizeBytes: new TextEncoder().encode(snapshot.content).byteLength,
    ...(snapshot.expiresAt !== undefined ? { expiresAt: snapshot.expiresAt } : {}),
  };
  return { snapshot, metadata };
}
