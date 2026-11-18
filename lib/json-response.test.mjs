import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { jsonResponse } = await jiti.import("./json-response.ts");

// Next compresses route handler responses at egress and strips any
// Content-Encoding a handler sets (GHSA-pc58-hwjq-p385), so a body compressed
// here reaches the client as gzip bytes labelled plain JSON.

test("never compresses, however large the payload", async () => {
  const response = jsonResponse({ value: "large payload ".repeat(200) });

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.equal((await response.json()).value, "large payload ".repeat(200));
});

test("labels the body as JSON and keeps the caller's headers", async () => {
  const response = jsonResponse({ ok: true }, { headers: { "Cache-Control": "no-store" } });

  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
});

test("passes a caller's status through", async () => {
  const response = jsonResponse({ error: "nope" }, { status: 404 });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "nope" });
});
