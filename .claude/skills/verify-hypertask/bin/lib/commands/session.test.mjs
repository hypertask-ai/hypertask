import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

const session = (dir, value) => {
  mkdirSync(join(dir, "default", "session"), { recursive: true });
  writeFileSync(join(dir, "default", "session", "session.json"), JSON.stringify(value));
};

test("session status reports no session before one starts", async () => {
  const result = await json(home(), ["session", "status"]);
  assert.equal(result.status, 0);
  assert.equal(result.json.data.running, false);
  assert.equal(result.json.data.pid, null);
});

test("session start --dry-run names the port, base and state", async () => {
  const dir = home();
  mkdirSync(join(dir, "default", "browser"), { recursive: true });
  writeFileSync(join(dir, "default", "browser", "state.json"), "{}", { mode: 0o600 });
  writeFileSync(join(dir, "default", "env.json"), JSON.stringify({ baseUrl: "http://127.0.0.1:3000" }));
  const result = await json(dir, ["session", "start", "--dry-run"]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.data.dryRun, true);
  assert.equal(result.json.data.base, "http://127.0.0.1:3000");
  assert.match(result.json.data.steps[0], /"port":\d+/);
  assert.match(result.json.data.steps[0], /browser\/state\.json/);
});

test("session start refuses a missing state and an unknown viewport", async () => {
  const dir = home();
  mkdirSync(join(dir, "default"), { recursive: true });
  writeFileSync(join(dir, "default", "env.json"), JSON.stringify({ baseUrl: "http://127.0.0.1:3000" }));
  const missing = await json(dir, ["session", "start", "--state", join(dir, "nope.json")]);
  assert.equal(missing.status, 2);
  assert.match(missing.json.error.next, /ht-verify seed/);
  mkdirSync(join(dir, "default", "browser"), { recursive: true });
  writeFileSync(join(dir, "default", "browser", "state.json"), "{}", { mode: 0o600 });
  const bad = await json(dir, ["session", "start", "--viewport", "wide"]);
  assert.equal(bad.status, 2);
  assert.match(bad.json.error.next, /WxH/);
});

test("session stop without a session is a no-op and an unknown action is usage", async () => {
  const stop = await json(home(), ["session", "stop"]);
  assert.equal(stop.status, 0);
  assert.equal(stop.json.data.stopped, false);
  const unknown = await json(home(), ["session", "restart"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.json.error.next, /start, status or stop/);
});

test("session status reports a dead recorded pid as not running", async () => {
  const dir = home();
  session(dir, { pid: 2 ** 22 + 11, port: 9999, base: "http://127.0.0.1:3000" });
  const result = await json(dir, ["session", "status"]);
  assert.equal(result.json.data.running, false);
});
