import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

test("down --dry-run names the recorded pid and the container", async () => {
  const dir = home();
  mkdirSync(join(dir, "default"), { recursive: true });
  writeFileSync(join(dir, "default", "dev.pid"), JSON.stringify({ pid: 4242, port: 3000 }));
  writeFileSync(join(dir, "default", "env.json"), JSON.stringify({ dbContainer: "hypertask-verify-db" }));
  const result = await json(dir, ["down", "--dry-run"]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.json.data.steps, ["kill 4242", "docker rm -f hypertask-verify-db", "docker volume rm hypertask-verify-db"]);
});

test("down --keep-db leaves the database alone", async () => {
  const dir = home();
  mkdirSync(join(dir, "default"), { recursive: true });
  const result = await json(dir, ["down", "--dry-run", "--keep-db"]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.json.data.steps, []);
  assert.equal(result.json.data.keptDatabase, true);
});
