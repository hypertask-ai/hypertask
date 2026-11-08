const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");
test("straight-board flag defaults to owner QA", () => {
  const def = loadModule("src/lib/flags/definitions/htpr-7553-email-straight-board.ts").default;
  assert.equal(def.key, "htpr-7553-email-straight-board");
  assert.equal(def.defaultMode, "OWNER_AND_QA");
});
