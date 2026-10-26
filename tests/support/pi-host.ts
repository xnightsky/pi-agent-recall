/**
 * @module tests/support/pi-host
 * 只读解析真实 CLI 身份；不通过 shell shim 启动，也不下载缺失宿主。
 */
import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

/** 从当前 PATH 解析可执行文件；缺失是显式前置条件。 */
export function findExecutable(name: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, name);
    try { accessSync(candidate, constants.X_OK); }
    catch (error) {
      if (["ENOENT", "EACCES", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
      throw error;
    }
    return realpathSync(candidate);
  }
  return undefined;
}

/** 验证 Pi 包名与确切版本；未知布局/版本不冒充已验证版本。 */
export function piInstallation(): { entry: string; version: string } | undefined {
  const entry = findExecutable("pi");
  if (!entry) return undefined;
  const manifest = JSON.parse(readFileSync(join(dirname(entry), "../../package.json"), "utf8"));
  if (manifest.name !== "@earendil-works/pi-coding-agent") throw new Error("Unexpected Pi installation");
  return { entry, version: String(manifest.version) };
}
