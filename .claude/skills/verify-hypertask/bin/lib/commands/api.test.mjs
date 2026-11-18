import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

function seeded(dir) {
  mkdirSync(join(dir, "default", "browser"), { recursive: true });
  writeFileSync(join(dir, "default", "browser", "state.json"), JSON.stringify({ cookies: [{ name: "ht_session", value: "private", domain: "127.0.0.1", path: "/", expires: -1 }] }));
  writeFileSync(join(dir, "default", "env.json"), JSON.stringify({ baseUrl: "http://127.0.0.1:9" }));
}

test("api refuses a write without --confirm and prints a dry run instead", async () => {
  const dir = home();
  seeded(dir);
  const refused = await json(dir, ["api", "POST", "/api/tasks/create", "--data", '{"title":"x"}']);
  assert.equal(refused.status, 2);
  assert.equal(refused.json.error.code, "refused");
  assert.match(refused.json.error.next, /--confirm/);
  const preview = await json(dir, ["api", "POST", "/api/tasks/create", "--data", '{"title":"x"}', "--confirm", "--dry-run"]);
  assert.equal(preview.status, 0);
  assert.deepEqual(preview.json.data.steps[0], { method: "POST", url: "http://127.0.0.1:9/api/tasks/create", data: { title: "x" } });
});

test("api needs a path and never prints the cookie", async () => {
  const missing = await json(home(), ["api"]);
  assert.equal(missing.status, 2);
  assert.match(missing.json.error.next, /ht-verify api/);
  const dir = home();
  seeded(dir);
  const result = await json(dir, ["api", "GET", "/api/flags"]);
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout, /private/);
});
