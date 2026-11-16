const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

let mode = null;
const prisma = {
  featureFlag: { findUnique: async () => (mode ? { mode } : null) },
};
const flags = loadModule("src/lib/flags.ts", {
  "@/lib/prisma": { default: prisma },
});
const { HTPR_7194_TASK_BOX_OUTLINES_FLAG: key } = loadModule(
  "src/lib/flags/definitions/htpr-7194-task-box-outlines.ts",
);

test("task box outlines default on for everyone and respect an explicit Off mode", async () => {
  assert.deepEqual(await Promise.all([6, 985, 7].map((id) => flags.isFeatureEnabled(key, id))), [true, true, true]);
  mode = "OFF";
  assert.deepEqual(await Promise.all([6, 985, 7].map((id) => flags.isFeatureEnabled(key, id))), [false, false, false]);
});
