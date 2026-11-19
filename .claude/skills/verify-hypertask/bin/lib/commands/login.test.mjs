import { strict as assert } from "node:assert";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

test("login selects the named account without printing a cookie or a token", async () => {
  const result = await json(home(), ["login", "free", "--no-verify"]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.data.account, "free");
  assert.equal(result.json.data.expectedUserId, 3411);
  assert.match(result.json.data.stateFile, /state-free\.json$/);
  assert.doesNotMatch(result.stdout, /"cookies?"|session|token/s);
});

test("login refuses an unknown account and guest with verification", async () => {
  const unknown = await json(home(), ["login", "admin", "--no-verify"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.json.error.next, /--help/);
  const guest = await json(home(), ["login", "guest"]);
  assert.equal(guest.status, 2);
  assert.match(guest.json.error.next, /logged-out/);
});
