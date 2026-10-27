/** 零 token 包契约：真实 tarball 离线消费与随包教程验证，不拉起宿主 CLI。 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temporary = join(root, ".tmp");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command: string, args: string[], cwd = root): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, COREPACK_ENABLE_NETWORK: "0" }, stdio: ["ignore", "pipe", "pipe"] });
}

test("tarball 离线消费公开接口与教程，私有路径不可导入", () => {
  mkdirSync(temporary, { recursive: true });
  const consumer = mkdtempSync(join(temporary, "package-consumer-"));
  try {
    run(pnpm, ["build"]);
    run(pnpm, ["pack", "--pack-destination", consumer]);
    const tarball = readdirSync(consumer).find(file => file.endsWith(".tgz"));
    assert.ok(tarball, "pack 必须实际产出 tarball");
    writeFileSync(join(consumer, "package.json"), JSON.stringify({
      name: "offline-contract-consumer", private: true, type: "module",
      dependencies: { "pi-agent-recall": "file:./" + tarball },
    }));
    run(pnpm, ["install", "--offline", "--ignore-scripts", "--store-dir", join(temporary, "pnpm-store"),
      "--config.cache-dir=" + join(temporary, "pnpm-cache"), "--config.state-dir=" + join(temporary, "state")], consumer);
    writeFileSync(join(consumer, "check.mjs"), runtimeConsumer);
    assert.match(run(process.execPath, ["check.mjs"], consumer), /package-contract-ok/);
    writeFileSync(join(consumer, "check.mts"), typedConsumer);
    writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], noEmit: true,
    }, include: ["check.mts"] }));
    run(pnpm, ["exec", "tsc", "-p", join(consumer, "tsconfig.json")]);
    const manifest = JSON.parse(readFileSync(join(consumer, "node_modules/pi-agent-recall/package.json"), "utf8"));
    assert.equal(manifest.private, true);
    assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
    const tutorial = join(consumer, "node_modules/pi-agent-recall/docs/examples/core-walkthrough.mjs");
    assert.ok(readdirSync(join(consumer, "node_modules/pi-agent-recall/docs")).includes("examples"), "tarball 必须包含可运行教程");
    const tutorialOutput = run(process.execPath, [tutorial], consumer);
    for (const stage of ["shadow", "stale-fence", "anchor-changed", "submitted", "duplicate", "withdraw-off", "replay"]) {
      assert.ok(tutorialOutput.includes("tutorial:" + stage), "教程缺少已验证步骤：" + stage);
    }
    assert.match(tutorialOutput, /tutorial-walkthrough-ok/);
  } finally { rmSync(consumer, { recursive: true, force: true }); }
});

const runtimeConsumer = `
import assert from "node:assert/strict";
import { createPolicyCore } from "pi-agent-recall/core";
import { createFakeClock, createFakeSink, replay } from "pi-agent-recall/testing";
import { createPiRecallExtension } from "pi-agent-recall/pi";
const options = { scope: "consumer", owner: "one", incarnation: "runtime-unique" };
assert.equal(createPolicyCore(options).getState().profile.settings.mode, "off");
assert.equal(createFakeClock(1).advance(2), 3);
assert.deepEqual(createFakeSink().getCalls(), []);
assert.equal(replay(options, []).state.active, true);
assert.equal(typeof createPiRecallExtension, "function");
for (const path of ["pi-agent-recall/dist/core/profile.js", "pi-agent-recall"]) {
  await assert.rejects(import(path), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
}
console.log("package-contract-ok");
`;

const typedConsumer = `
import { createPolicyCore, type PolicyCore, type AnchorMetadata } from "pi-agent-recall/core";
import { replay, type ReplayEvent, type FakeClock, createFakeClock } from "pi-agent-recall/testing";
import { createPiRecallExtension, type PiRecallTrace, type PiAnchorProvider } from "pi-agent-recall/pi";
const trace: PiRecallTrace = { event: "check" };
void trace;
const anchors: PiAnchorProvider = { current: () => undefined };
void createPiRecallExtension;
void anchors;
const options = { scope: "s", owner: "o", incarnation: "unique" };
const core: PolicyCore = createPolicyCore(options);
const anchor: AnchorMetadata = { ref: { provider: "rules", id: "one" }, version: "1", sizeBytes: 10 };
const clock: FakeClock = createFakeClock();
const events: ReplayEvent[] = [{ kind: "evaluate", input: {
  now: clock.now(), anchor, candidate: { anchor: anchor.ref, fence: core.getState().fence,
    observedAt: 0, provenance: "external", facts: { nextRequest: "available", activity: "active",
    continuation: "present", evidenceCount: 1, capabilities: { reanchor: true, wake: false } } }
} }];
replay(options, events);
`;
