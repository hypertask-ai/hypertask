import { strict as assert } from "node:assert";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

test("open needs a path and a live session", async () => {
  const missing = await json(home(), ["open"]);
  assert.equal(missing.status, 2);
  assert.match(missing.json.error.next, /ht-verify open/);
  const result = await json(home(), ["open", "/my-tasks"]);
  assert.equal(result.status, 1);
  assert.equal(result.json.error.code, "not-ready");
  assert.match(result.json.error.next, /session start/);
});

test("shot --session needs an output path and a live session", async () => {
  const missing = await json(home(), ["shot", "--session"]);
  assert.equal(missing.status, 2);
  assert.match(missing.json.error.next, /--out/);
  const result = await json(home(), ["shot", "--session", "--out", "/tmp/session.png"]);
  assert.equal(result.status, 1);
  assert.match(result.json.error.next, /session start/);
});
