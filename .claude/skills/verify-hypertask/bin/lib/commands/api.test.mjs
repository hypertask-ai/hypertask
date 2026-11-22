import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { home, json, serve } from "../test-helpers.mjs";

function seeded(dir, port = 9) {
  mkdirSync(join(dir, "default", "browser"), { recursive: true });
  writeFileSync(join(dir, "default", "browser", "state.json"), JSON.stringify({ cookies: [{ name: "ht_session", value: "private", domain: "127.0.0.1", path: "/", expires: -1 }] }));
  writeFileSync(join(dir, "default", "env.json"), JSON.stringify({ baseUrl: `http://127.0.0.1:${port}` }));
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

test("api resolves --account through qa-login and refuses an unknown one before any request", async () => {
  const dir = home();
  seeded(dir);
  const unknown = await json(dir, ["api", "GET", "/api/flags", "--base", "https://app.hypertask.ai", "--account", "nope"]);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.json.error.code, "usage");
  assert.match(unknown.json.error.message, /unknown account nope/);
  assert.match(unknown.json.error.next, /--state/);
});

test("api reports a 403 as a route refusal, not an expired identity", async () => {
  const server = await serve(403);
  const dir = home();
  seeded(dir, server.address().port);
  try {
    const refused = await json(dir, ["api", "GET", "/login"]);
    assert.equal(refused.status, 1);
    assert.equal(refused.json.error.code, "forbidden");
    assert.doesNotMatch(refused.json.error.message, /identity expired/);
    assert.match(refused.json.error.next, /not an expired identity/);
    assert.equal(refused.json.data.status, 403);
    const ok = await json(dir, ["api", "GET", "/api/flags"]);
    assert.equal(ok.status, 0);
    assert.equal(ok.json.ok, true);
  } finally {
    server.close();
  }
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
