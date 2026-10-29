const assert = require("node:assert/strict");
const test = require("node:test");
const { loader } = require("./helpers/htpr-7260-ui.cjs");

test("fullscreen chat return is available to customers and respects an Off override", async () => {
  const { default: definition } = loader()(
    "src/lib/flags/definitions/htpr-8052-fullscreen-chat-return.ts"
  );
  let row = null;
  const db = { featureFlag: { findUnique: async () => row } };
  const { isFeatureEnabled } = loader({
    "@/lib/prisma": { default: {} },
    "@/lib/flags/definitions": { FEATURE_FLAG_DEFINITIONS: [definition] },
    "@/lib/flags/keys": {},
  })("src/lib/flags.ts");
  assert.equal(await isFeatureEnabled("htpr-8052-fullscreen-chat-return", 2343, db), true);
  row = { mode: "OFF" };
  assert.equal(await isFeatureEnabled("htpr-8052-fullscreen-chat-return", 2343, db), false);
  assert.equal(await isFeatureEnabled("htpr-8052-fullscreen-chat-return", 985, db), false);
});
