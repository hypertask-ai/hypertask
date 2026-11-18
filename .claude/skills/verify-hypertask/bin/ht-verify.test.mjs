import { strict as assert } from "node:assert";
import { test } from "node:test";
import { home, json } from "./lib/test-helpers.mjs";

test("help lists the commands and each one documents its flags", async () => {
  const help = await json(home(), ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /\n  up\s+start the disposable local stack/);
  const page = await json(home(), ["help", "up"]);
  assert.equal(page.status, 0);
  assert.match(page.stdout, /Usage:/);
  assert.match(page.stdout, /Example:/);
});

test("an unknown command or option is a usage error that names the next step", async () => {
  const unknown = await json(home(), ["frobnicate"]);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.json.ok, false);
  assert.equal(unknown.json.error.code, "usage");
  assert.match(unknown.json.error.next, /--help/);
  const option = await json(home(), ["up", "--bogus"]);
  assert.equal(option.status, 2);
  assert.equal(option.json.error.code, "usage");
  assert.match(option.json.error.message, /--bogus/);
  assert.match(option.json.error.next, /ht-verify help/);
});
