import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
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
  assert.equal(result.json.data.dryRun, true);
});

test("down kills only a pid that still runs Next", async () => {
  const dir = home();
  mkdirSync(join(dir, "default"), { recursive: true });
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)", "next"], { detached: true, stdio: "ignore" });
  writeFileSync(join(dir, "default", "dev.pid"), JSON.stringify({ pid: child.pid }));
  const result = await json(dir, ["down", "--keep-db"]);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(result.json.data.stopped, [`process group ${child.pid}`]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.throws(() => process.kill(child.pid, 0));
  writeFileSync(join(dir, "default", "dev.pid"), JSON.stringify({ pid: process.pid }));
  const skipped = await json(dir, ["down", "--keep-db"]);
  assert.deepEqual(skipped.json.data.stopped, []);
  assert.match(skipped.json.data.skipped, /no longer runs Next/);
});

test("down --keep-db leaves the database alone and refuses a bad pid", async () => {
  const dir = home();
  mkdirSync(join(dir, "default"), { recursive: true });
  const kept = await json(dir, ["down", "--dry-run", "--keep-db"]);
  assert.deepEqual(kept.json.data.steps, []);
  assert.equal(kept.json.data.keptDatabase, true);
  writeFileSync(join(dir, "default", "dev.pid"), JSON.stringify({ pid: "-1" }));
  const refused = await json(dir, ["down", "--dry-run"]);
  assert.equal(refused.status, 2);
  assert.match(refused.json.error.message, /refusing to kill/);
});
