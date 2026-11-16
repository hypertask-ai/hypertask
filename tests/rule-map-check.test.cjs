const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const loaded = import("../scripts/check-rule-map.mjs");

const policy = {
  unenforcedMarker: "Skill text, not enforced",
  unenforcedCeiling: 1,
  enforcedHeading: "## Enforced",
  checks: ["eslint-local-rules/no-comments.mjs"],
  retiredInMap: ["Keep code comments only for non-obvious reasons"],
};

const map = [
  "## Enforced",
  "",
  "| Check |",
  "| --- |",
  "| `eslint-local-rules/no-comments.mjs` |",
  "",
  "| Still open | skill | Skill text, not enforced |",
].join("\n");

test("a new unenforced row fails", async () => {
  const { audit } = await loaded;
  const problems = audit({
    markdown: `${map}\n| Another | skill | Skill text, not enforced |`,
    policy,
    exists: () => true,
  });
  assert.deepEqual(problems, [
    "Unenforced agent rules grew from 1 to 2. Add a check, delete the rule text, then set the ceiling to the new count.",
  ]);
});

test("retired comment rule text fails", async () => {
  const { audit } = await loaded;
  const problems = audit({
    markdown: `${map}\nKeep code comments only for non-obvious reasons`,
    policy,
    exists: () => true,
  });
  assert.deepEqual(problems, [
    "Retired rule text is back: Keep code comments only for non-obvious reasons",
  ]);
});

test("a missing check file fails", async () => {
  const { audit } = await loaded;
  const problems = audit({ markdown: map, policy, exists: () => false });
  assert.deepEqual(problems, [
    "Check file is missing: eslint-local-rules/no-comments.mjs",
  ]);
});

test("dropping a row fails until the ceiling drops with it", async () => {
  const { audit } = await loaded;
  const problems = audit({
    markdown: map.replace("\n| Still open | skill | Skill text, not enforced |", ""),
    policy,
    exists: () => true,
  });
  assert.deepEqual(problems, [
    "Unenforced agent rules fell from 1 to 0. Set the ceiling to 0 in the same change.",
  ]);
});

test("the repository map matches its ceiling and its check files exist", async () => {
  const { auditRepo } = await loaded;
  assert.deepEqual(auditRepo(path.join(__dirname, "..")), []);
});
