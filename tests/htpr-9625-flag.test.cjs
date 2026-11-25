const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

test("HTPR-9625 agents join boards flag defaults to Owner and QA", () => {
  const { default: flag, HTPR_9625_AGENTS_JOIN_BOARDS_FLAG: key } = load("src/lib/flags/definitions/htpr-9625-agents-join-boards.ts");
  assert.equal(key, "htpr-9625-agents-join-boards");
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "new");
  assert.equal(flag.releaseRisk.highRisk, "access");
  assert.equal(flag.releaseRisk.harmEvidence.harm, "auth-bypass");
  assert.match(flag.releaseRisk.harmEvidence.scenario, /another team/);
});
