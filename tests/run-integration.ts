/**
 * @module tests/run-integration
 * 零 token 集成入口；付费文件不加载，suite 临时目录只写本仓 .tmp。
 */
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { integrationTestFiles } from "./support/test-files.js";

const directory = resolve("tests/integration");
const files = integrationTestFiles(readdirSync(directory, { recursive: true, encoding: "utf8" }))
  .map((file) => resolve(directory, file));
if (files.length === 0) throw new Error("No zero-token integration tests found");
const temporary = resolve(".tmp/pi-pty");
mkdirSync(temporary, { recursive: true });
const localTemporary = realpathSync(mkdtempSync(join(temporary, "run-")));
try {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
    stdio: "inherit",
    env: { ...process.env, TMPDIR: localTemporary, TMP: localTemporary, TEMP: localTemporary },
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Integration worker terminated: ${result.signal}`);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(localTemporary, { recursive: true, force: true });
}
