import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { home, json, serve } from "../test-helpers.mjs";

function storageState(dir) {
  const file = join(dir, "state.json");
  writeFileSync(file, JSON.stringify({
    cookies: [{ name: "session", value: "placeholder", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
    origins: [],
  }));
  return file;
}

function runFolder(dir, baseUrl) {
  mkdirSync(join(dir, "default"), { recursive: true });
  writeFileSync(join(dir, "default", "env.json"), JSON.stringify({ baseUrl, port: 3000, dbPort: 5678 }));
}

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

test("login verifies the run folder base it reports", async () => {
  const dir = home();
  const server = await serve(200, 4242);
  try {
    runFolder(dir, `http://127.0.0.1:${server.address().port}`);
    const result = await json(dir, ["login", "free", "--state", storageState(dir), "--expect", "4242"]);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.json.target, "local");
    assert.equal(result.json.data.baseUrl, `http://127.0.0.1:${server.address().port}`);
    assert.equal(result.json.data.userId, 4242);
    assert.equal(result.json.data.verified, true);
  } finally {
    server.close();
  }
});

test("login fails on a dead run folder base instead of passing through production", async () => {
  const dir = home();
  const server = await serve(200, 4242);
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  runFolder(dir, `http://127.0.0.1:${port}`);
  const result = await json(dir, ["login", "free", "--state", storageState(dir)]);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.json.ok, false);
  assert.match(result.json.error.message, /identity unreadable/);
});

test("login refuses a base that is neither production nor loopback", async () => {
  const dir = home();
  const result = await json(dir, ["login", "free", "--base-url", "https://staging.example.test", "--state", storageState(dir)]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.json.error.message, /loopback origin/);
  assert.match(result.json.error.next, /--base-url/);
});
