const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("registry exposes htpr-8929 column select all at Owner and QA", () => {
  const jiti = require("jiti")(__filename);
  const { FEATURE_FLAG_DEFINITIONS } = jiti(
    path.join(root, "src/lib/flags/definitions.ts"),
  );
  const key = "htpr-8929-column-select-all";
  const definition = FEATURE_FLAG_DEFINITIONS.find((flag) => flag.key === key);
  assert.ok(definition, "generated registry contains the ticket flag");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.risk, "small");
});
