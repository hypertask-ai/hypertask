import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
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
  assert.match(plan, /next dev -p 3999/);
  assert.equal(spawnSync("test", ["-e", join(dir, "default")]).status, 1);
});

test("up refuses an invalid port before touching anything", async () => {
  const result = await json(home(), ["up", "--port", "80"]);
  assert.equal(result.status, 2);
  assert.equal(result.json.error.code, "usage");
  assert.match(result.json.error.next, /1024 and 65535/);
});
