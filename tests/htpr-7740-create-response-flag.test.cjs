process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const filename = "src/lib/flags/definitions/htpr-7740-create-response.ts";

test("HTPR-7740: create response bugfix ships to Everyone with a small release risk", async () => {
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const source = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
  const { definition } = parseFlagFile(source, filename);
  assert.equal(definition.key, "htpr-7740-create-response");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
});
