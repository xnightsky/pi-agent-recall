/**
 * @module tests/support/pi-network
 * 先用普通 Node 子进程验证同一网络策略，再允许启动 Pi；不回退无保护运行。
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SandboxContext } from "x-agent-suite/contracts";
import { loopbackPort } from "./pi-fixture.js";

const probe = `
import net from "node:net";
function connect(host, port, denied) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("network probe timeout")); });
    socket.on("connect", () => { socket.destroy(); denied ? reject(new Error("unexpected access")) : resolve(); });
    socket.on("error", (error) => {
      socket.destroy();
      if (denied && ["EPERM", "EACCES"].includes(error.code)) resolve();
      else reject(error);
    });
  });
}
await connect("127.0.0.1", Number(process.argv[1]), false);
await connect("127.0.0.1", Number(process.argv[2]), true);
await connect("192.0.2.1", 9, true);
console.log("NETWORK_GUARD_OK");
`;

/** 验证目标端口可达，其余 loopback 与保留非 loopback 地址被 OS 拒绝。 */
export async function verifyNetworkIsolation(sandbox: SandboxContext, executable: string): Promise<void> {
  const config = JSON.parse(await readFile(join(sandbox.configDirs!.piHome!, "models.json"), "utf8"));
  const url = String(config.providers["recall-fixture"].baseUrl);
  const port = loopbackPort(url.replace(/\/v1$/, ""));
  const forbidden = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    forbidden.once("error", reject);
    forbidden.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = forbidden.address();
    assert.ok(address && typeof address !== "string");
    const result = await promisify(execFile)(executable, [
      "-f", join(sandbox.cwd, "network.sb"), process.execPath, "--input-type=module", "-e", probe,
      String(port), String(address.port),
    ], { env: sandbox.env, cwd: sandbox.cwd, timeout: 10_000 });
    assert.equal(result.stdout.trim(), "NETWORK_GUARD_OK");
  } finally {
    await new Promise<void>((resolve, reject) => forbidden.close((error) => error ? reject(error) : resolve()));
  }
}
