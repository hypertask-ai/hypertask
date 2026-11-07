const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

test("HTPR-8926 flag stays at Owner + QA until independent design QA", () => {
  const { default: flag, HTPR_8926_COMMENT_MIC_PATTERN_FLAG: key } = load("src/lib/flags/definitions/htpr-8926-comment-mic-pattern.ts");
  assert.equal(key, "htpr-8926-comment-mic-pattern");
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "small");
});
