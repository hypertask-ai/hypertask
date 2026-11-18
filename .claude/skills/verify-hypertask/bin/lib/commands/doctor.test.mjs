import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { home, json, serve, tcp } from "../test-helpers.mjs";

test("doctor on a healthy local instance reports every check true", async () => {
  const web = await serve(200);
  const db = await tcp();
  const dir = home();
  mkdirSync(join(dir, "default", "browser"), { recursive: true });
  writeFileSync(join(dir, "default", "browser", "state.json"), JSON.stringify({ cookies: [{ name: "ht_session", value: "x", domain: "127.0.0.1", path: "/", expires: -1 }] }));
  writeFileSync(join(dir, "default", "env.json"), JSON.stringify({
    baseUrl: `http://127.0.0.1:${web.address().port}`,
    databaseUrl: `postgresql://verify:verify@127.0.0.1:${db.address().port}/hypertask`,
    pid: process.pid,
  }));
  const result = await json(dir, ["doctor"]);
  web.close();
  db.close();
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.ok, true);
  assert.deepEqual(result.json.data.checks.map((check) => check.name), ["page /login", "database", "dev pid", "identity"]);
  assert.equal(result.json.data.checks.find((check) => check.name === "identity").detail, "identity ok: user 985");
  assert.equal(result.json.data.checks.every((check) => check.ok), true);
});

test("doctor fails on an instance that does not answer and names the failing checks", async () => {
  const web = await serve(503);
  const dir = home();
  mkdirSync(join(dir, "default"), { recursive: true });
  writeFileSync(join(dir, "default", "env.json"), JSON.stringify({ baseUrl: `http://127.0.0.1:${web.address().port}` }));
  const result = await json(dir, ["doctor"]);
  web.close();
  assert.equal(result.status, 1);
  assert.equal(result.json.ok, false);
  assert.deepEqual(result.json.data.failed, ["page /login", "database", "dev pid", "identity"]);
  assert.match(result.json.error.next, /ht-verify up/);
});

test("doctor verifies a seeded local state and fails a production ticket gap", async () => {
  const web = await serve(200);
  const dir = home();
  mkdirSync(join(dir, "default", "browser"), { recursive: true });
  writeFileSync(join(dir, "default", "env.json"), JSON.stringify({ baseUrl: `http://127.0.0.1:${web.address().port}`, databaseUrl: `postgresql://verify:verify@127.0.0.1:${web.address().port}/hypertask`, pid: process.pid }));
  writeFileSync(join(dir, "default", "browser", "state.json"), JSON.stringify({ cookies: [{ name: "ht_session", value: "x", domain: "127.0.0.1", path: "/", expires: -1 }] }));
  const seeded = await json(dir, ["doctor"]);
  web.close();
  assert.equal(seeded.status, 0, seeded.stdout);
  assert.equal(seeded.json.data.checks.find((check) => check.name === "identity").detail, "identity ok: user 985");
  assert.deepEqual(seeded.json.data.failed, []);
  const gap = await json(home(), ["doctor", "--target", "production"]);
  assert.equal(gap.status, 2);
  assert.match(gap.json.error.next, /--ticket/);
});
