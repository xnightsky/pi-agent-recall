import assert from "node:assert/strict";
import test from "node:test";
import { readAnchor } from "../../src/pi/anchor.js";

test("缺失锚点返回 undefined，不回退旧正文", () => {
  assert.equal(readAnchor({ current: () => undefined }), undefined);
});

test("同一快照生成真实 UTF-8 元数据并与外部修改隔离", () => {
  const current = { ref: { provider: "roles", id: "current" }, version: "v1", content: "锚", expiresAt: 20 };
  const read = readAnchor({ current: () => current });
  assert.ok(read);
  assert.equal(read.metadata.sizeBytes, 3);
  assert.equal(read.metadata.version, "v1");
  assert.equal(read.metadata.expiresAt, 20);
  assert.equal(read.snapshot.content, "锚");
  current.version = "v2";
  current.content = "changed";
  current.ref.id = "other";
  assert.equal(read.snapshot.version, "v1");
  assert.equal(read.snapshot.content, "锚");
  assert.equal(read.metadata.ref.id, "current");
});
