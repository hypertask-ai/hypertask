import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

const cli = fileURLToPath(new URL("../../ht-verify", import.meta.url));

test("seed refuses a missing and a remote database", async () => {
  const missing = await json(home(), ["seed"]);
  assert.equal(missing.status, 2);
  assert.match(missing.json.error.next, /ht-verify up/);
  const blocked = spawnSync(process.execPath, [cli, "seed"], {
    encoding: "utf8",
    env: { ...process.env, HT_VERIFY_HOME: home(), DATABASE_URL: "postgresql://u:p@db.internal:5432/hypertask" },
  });
  assert.equal(JSON.parse(blocked.stdout).error.code, "refused");
  assert.equal(blocked.status, 2);
});

test("seed --dry-run prints the wrapped script and its environment", async () => {
  const result = await json(home(), ["seed", "--dry-run"]);
  assert.equal(result.status, 0);
  const plan = result.json.data.steps.join("\n");
  assert.match(plan, /scripts\/seed-browser-smoke\.mjs/);
  assert.match(plan, /BROWSER_SMOKE_STATE_FILE=/);
  assert.equal(result.json.data.dryRun, true);
});
