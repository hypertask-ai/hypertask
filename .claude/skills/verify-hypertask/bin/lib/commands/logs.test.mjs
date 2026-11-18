import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

test("logs returns the trailing dev lines and filters with --grep", async () => {
  const dir = home();
  mkdirSync(join(dir, "default"), { recursive: true });
  writeFileSync(join(dir, "default", "dev.log"), "ready\nGET /login 200\nboom error\n");
  const tail = await json(dir, ["logs", "--lines", "2"]);
  assert.deepEqual(tail.json.data.lines, ["boom error", ""]);
  const filtered = await json(dir, ["logs", "--grep", "error"]);
  assert.deepEqual(filtered.json.data.lines, ["boom error"]);
});

test("logs reports a missing file and rejects both flags and a bad count", async () => {
  const missing = await json(home(), ["logs"]);
  assert.equal(missing.status, 1);
  assert.match(missing.json.error.next, /ht-verify up/);
  const both = await json(home(), ["logs", "--dev", "--browser"]);
  assert.equal(both.status, 2);
  const bad = await json(home(), ["logs", "--lines", "900"]);
  assert.equal(bad.status, 2);
  assert.match(bad.json.error.next, /between 1 and 500/);
});
