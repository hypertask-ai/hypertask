const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/htpr-7046-tldr-open-questions.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { applyOpenQuestionSummaryRules, OPEN_QUESTION_SUMMARY_RULES } = jiti(
  path.join(root, "src/app/api/ai/_lib/commentSummaries.ts")
);
const { renderPrompt } = jiti(path.join(root, "src/lib/ai/prompts/registry.ts"));
const flag = jiti(path.join(root, "src/lib/flags/definitions/htpr-7046-tldr-open-questions.ts"));

const base = renderPrompt("comment-summaries-instructions-1", "Output exactly one plain single sentence.");

test("flag on adds both open-question rules at the end of the HARD RULES list", () => {
  const out = applyOpenQuestionSummaryRules(base, true);
  assert.ok(out.startsWith(base));
  assert.match(out, /- Keep open questions open/);
  assert.match(out, /Never answer it/);
  assert.match(out, /- State only what the comment states\. Never add an answer, decision, owner, date, or fact the comment did not state\./);
  assert.ok(out.slice(base.length).startsWith("\n- "));
  assert.equal(OPEN_QUESTION_SUMMARY_RULES.trim().split("\n").length, 2);
});

test("flag off leaves the instructions unchanged", () => {
  assert.equal(applyOpenQuestionSummaryRules(base, false), base);
  assert.doesNotMatch(base, /Keep open questions open/);
});

test("flag is a bugfix that defaults to Everyone", () => {
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.key, "htpr-7046-tldr-open-questions");
  assert.equal(flag.default.defaultMode, undefined);
  assert.ok(flag.default.releaseRisk.risk && flag.default.releaseRisk.reason);
});
