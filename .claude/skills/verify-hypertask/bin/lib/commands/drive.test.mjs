import { strict as assert } from "node:assert";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

test("drive needs a known area", async () => {
  const missing = await json(home(), ["drive"]);
  assert.equal(missing.status, 2);
  assert.match(missing.json.error.next, /board, task, comments/);
  const unknown = await json(home(), ["drive", "chat"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.json.error.next, /ctrl-j/);
});

test("drive refuses a non-loopback base for every hands-free area", async () => {
  const result = await json(home(), ["drive", "board", "--base", "https://app.hypertask.ai"]);
  assert.equal(result.status, 2);
  assert.equal(result.json.error.code, "refused");
  assert.match(result.json.error.next, /127\.0\.0\.1/);
});
