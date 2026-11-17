const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const test = require("node:test");
const {
  alwaysRules,
  ruleChecks,
  problems,
  TABLE_FILE,
} = require("../scripts/lib/agent-rule-check-table.cjs");

const root = resolve(__dirname, "..");
const agentsMarkdown = readFileSync(join(root, "AGENTS.md"), "utf8");
const tableMarkdown = readFileSync(join(root, TABLE_FILE), "utf8");

const table = (...rows) => [
  "| Rule | Enforced by |",
  "| --- | --- |",
  ...rows,
].join("\n");

test("AGENTS.md pairs every Always rule with a check that exists", () => {
  assert.deepEqual(problems(agentsMarkdown, tableMarkdown), []);
});

test("the rule checks file names one row per Always rule", () => {
  const rules = alwaysRules(agentsMarkdown);
  assert.ok(rules.length >= 10, `found ${rules.length} Always rules`);
  assert.equal(ruleChecks(tableMarkdown).length, rules.length);
});

test("a rule row naming a check file that does not exist is reported", () => {
  const rows = table(
    "| Rule one. | `.github/scripts/not-a-real-check.cjs` |",
    "| Rule two. | nothing yet |",
  );
  const rules = ["## Always", "- Rule one.", "- Rule two.", TABLE_FILE].join("\n");
  assert.deepEqual(problems(rules, rows), [
    "Rule row names a check file that does not exist (.github/scripts/not-a-real-check.cjs): Rule one.",
  ]);
});

test("a rule row naming no check at all is reported", () => {
  const rules = ["## Always", "- Rule one.", "- Rule two.", TABLE_FILE].join("\n");
  assert.deepEqual(problems(rules, table("| Rule one. | TBD |", "| Rule two. | nothing yet |")), [
    'Rule row names no check file and does not say "nothing yet": Rule one.',
  ]);
});

test("every Always rule needs its own row and only real rules may have one", () => {
  const rules = ["## Always", "- Rule one.", "- Rule two.", TABLE_FILE].join("\n");
  assert.deepEqual(problems(rules, table("| Rule one. | nothing yet |", "| Gone rule. | nothing yet |")), [
    "Rule has no table row: Rule two.",
    "Table row names no Always rule: Gone rule.",
  ]);
});

test("a missing rule table is reported", () => {
  const rules = ["## Always", "- Rule one."].join("\n");
  assert.deepEqual(problems(rules, ""), [
    "AGENTS.md does not link .claude/reference/rule-checks.md.",
    ".claude/reference/rule-checks.md has no rule table.",
    "Rule has no table row: Rule one.",
  ]);
});

test("the real row shapes pass: a live path and nothing yet", () => {
  const rules = ["## Always", "- Rule one.", "- Rule two.", "", TABLE_FILE].join("\n");
  assert.deepEqual(problems(rules, table(
    "| Rule one. | `.github/scripts/pr-title.cjs` |",
    "| Rule two. | nothing yet |",
  )), []);
});
