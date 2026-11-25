import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

test("flags set refuses Off and a reasonless switch before touching the API", async () => {
  const off = await json(home(), ["flags", "set", "htpr-1234-x", "off", "--failure", "broken"]);
  assert.equal(off.status, 2);
  assert.equal(off.json.error.code, "refused");
  assert.match(off.json.error.next, /safety switch/);
  const noReason = await json(home(), ["flags", "set", "htpr-1234-x", "owner-qa"]);
  assert.equal(noReason.status, 2);
  assert.match(noReason.json.error.next, /--reason, or hold a broken flag with --failure/);
});

test("flags show needs a key and an unknown action is usage", async () => {
  const missing = await json(home(), ["flags", "show"]);
  assert.equal(missing.status, 2);
  assert.match(missing.json.error.next, /flags show/);
  const unknown = await json(home(), ["flags", "toggle"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.json.error.next, /list, show or set/);
});
