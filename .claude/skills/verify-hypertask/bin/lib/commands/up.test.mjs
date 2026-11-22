import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import up from "./up.cjs";
import { home, json } from "../test-helpers.mjs";

test("up --dry-run prints the docker, prisma and Next commands without writing", async () => {
  const dir = home();
  const result = await json(dir, ["up", "--dry-run", "--port", "3999"]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.data.dryRun, true);
  assert.equal(result.json.data.baseUrl, "http://127.0.0.1:3999");
  const plan = result.json.data.steps.join("\n");
  assert.match(plan, /postgres:14\.0-alpine/);
  assert.match(plan, /prisma migrate deploy/);
  assert.match(plan, /next start -H 127\.0\.0\.1 -p 3999/);
  assert.match(plan, /next build/);
  assert.match(plan, /hypertask-verify-redis/);
  assert.match(plan, /hypertask-verify-soketi/);
  assert.match(plan, /-p 127\.0\.0\.1:5678:5432/);
  assert.match(plan, /-v hypertask-verify-db:\/var\/lib\/postgresql\/data/);
  assert.equal(spawnSync("test", ["-e", join(dir, "default")]).status, 1);
  const bad = await json(home(), ["up", "--port", "80"]);
  assert.equal(bad.status, 2);
  assert.match(bad.json.error.next, /between 1024 and 65535/);
});

test("up reuses a build only from this port and this source stamp", () => {
  const stamp = "b2ff1c";
  assert.equal(up.buildReusable(true, "http://127.0.0.1:3000", "http://127.0.0.1:3000", stamp, stamp), true);
  assert.equal(up.buildReusable(false, "http://127.0.0.1:3000", "http://127.0.0.1:3000", stamp, stamp), false);
  assert.equal(up.buildReusable(true, "http://127.0.0.1:3000", "http://127.0.0.1:3999", stamp, stamp), false);
  assert.equal(up.buildReusable(true, "http://127.0.0.1:3000", "http://127.0.0.1:3000", stamp, "9a01de"), false);
  assert.equal(up.buildReusable(true, "http://127.0.0.1:3000", "http://127.0.0.1:3000", undefined, stamp), false);
});

test("up reuses only its own production server and refuses a port it does not own", () => {
  const served = { mode: "production", port: 3000 };
  assert.deepEqual(up.reuseServer({ previous: served, port: 3000, pidAlive: true, answered: true }), { reused: true, conflict: false });
  assert.deepEqual(up.reuseServer({ previous: served, port: 3000, pidAlive: false, answered: true }), { reused: false, conflict: true });
  assert.deepEqual(up.reuseServer({ previous: { mode: "dev", port: 3000 }, port: 3000, pidAlive: true, answered: true }), { reused: false, conflict: true });
  assert.deepEqual(up.reuseServer({ previous: served, port: 3999, pidAlive: true, answered: true }), { reused: false, conflict: true });
  assert.deepEqual(up.reuseServer({ previous: {}, port: 3000, pidAlive: false, answered: false }), { reused: false, conflict: false });
});
