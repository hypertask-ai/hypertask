import { strict as assert } from "node:assert";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

test("press needs a key and a live session", async () => {
  const missing = await json(home(), ["press"]);
  assert.equal(missing.status, 2);
  assert.match(missing.json.error.next, /ht-verify press/);
  const result = await json(home(), ["press", "Escape"]);
  assert.equal(result.status, 1);
  assert.equal(result.json.error.code, "not-ready");
  assert.match(result.json.error.next, /session start/);
});

test("press refuses a nonsense repeat count", async () => {
  const result = await json(home(), ["press", "j", "--count", "0"]);
  assert.equal(result.status, 2);
  assert.match(result.json.error.next, /repeat count/);
});

test("probe needs a selector and a live session", async () => {
  const missing = await json(home(), ["probe"]);
  assert.equal(missing.status, 2);
  assert.match(missing.json.error.next, /ht-verify probe/);
  const result = await json(home(), ["probe", "html", "--attr", "data-theme"]);
  assert.equal(result.status, 1);
  assert.equal(result.json.error.code, "not-ready");
});

test("probe refuses a session-shaped cookie name", async () => {
  const result = await json(home(), ["probe", "--cookie", "better-auth.session_token"]);
  assert.equal(result.status, 2);
  assert.equal(result.json.error.code, "refused");
  assert.match(result.json.error.next, /Session values are never printed/);
});
