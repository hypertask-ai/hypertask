const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("batch hold rules and approved caps", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "tests/htpr-7394-deeper-batch-hold.mts"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /deeper-batch-hold-ok/);
});

test("batch spend is held before the gateway call and settled before apply", () => {
  const submit = read("src/lib/ai/batch/submitBatch.ts");
  const collect = read("src/lib/ai/batch/collectBatches.ts");
  assert.ok(submit.indexOf("await holdPlanBatch") < submit.indexOf("startGatewayBatch(args.gatewayKey"));
  assert.ok(submit.indexOf("await releasePlanBatch") > submit.indexOf("startGatewayBatch(args.gatewayKey"));
  assert.ok(collect.indexOf("await settleHeldBatch") < collect.indexOf("applySlackBatch"));
  assert.ok(collect.indexOf("settleHeldBatch") < collect.indexOf("applyLabelBatch"));
  assert.match(read("src/lib/ai/spend/batchHold.ts"), /lane: "visible"/);
  assert.match(read("src/lib/ai/spend/batchHold.ts"), /holdUntilMs: monthEndHoldUntilMs/);
  assert.match(read("src/lib/ai/batch/batchJobs.ts"), /batchEligibleWhenCapped\(source, planMode, holdsOn\)/);
});

test("remaining spend flag stays owner and QA and is a money change", () => {
  const flag = read("src/lib/flags/definitions/htpr-7394-remaining-ai-spend.ts");
  assert.match(flag, /defaultMode: "OWNER_AND_QA"/);
  assert.match(flag, /highRisk: "money"/);
  assert.match(flag, /harm: "charge"/);
  assert.match(read("src/app/api/ai/_lib/editorAi.ts"), /nativeWebSearchAllowed\(/);
  assert.match(read("src/utils/controllers/turbopuffer/turbopufferHelper.ts"), /withEmbeddingCharge\(/);
  assert.match(read("src/app/api/ai/_lib/sharedAllowance.ts"), /renewLiveReservation\(/);
});
