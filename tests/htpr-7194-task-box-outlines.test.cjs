const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let mode = null;
const prisma = {
  featureFlag: { findUnique: async () => mode ? { mode } : null },
};
const filename = path.join(root, "src/lib/prisma.ts");
require.cache[filename] = { id: filename, filename, loaded: true, exports: { __esModule: true, default: prisma } };
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") }, fsCache: false });
const flags = jiti(path.join(root, "src/lib/flags.ts"));
const { HTPR_7194_TASK_BOX_OUTLINES_FLAG: key } = jiti(path.join(root, "src/lib/flags/definitions/htpr-7194-task-box-outlines.ts"));

test("task box outlines default on for everyone and respect an explicit Off mode", async () => {
  assert.deepEqual(await Promise.all([6, 985, 7].map(id => flags.isFeatureEnabled(key, id))), [true, true, true]);
  mode = "OFF";
  assert.deepEqual(await Promise.all([6, 985, 7].map(id => flags.isFeatureEnabled(key, id))), [false, false, false]);
});
