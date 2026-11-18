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
  assert.match(plan, /-p 127\.0\.0\.1:5678:5432/);
  assert.match(plan, /-v hypertask-verify-db:\/var\/lib\/postgresql\/data/);
  assert.equal(spawnSync("test", ["-e", join(dir, "default")]).status, 1);
  const bad = await json(home(), ["up", "--port", "80"]);
  assert.equal(bad.status, 2);
  assert.match(bad.json.error.next, /between 1024 and 65535/);
});
