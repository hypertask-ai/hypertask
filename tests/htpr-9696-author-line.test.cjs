const assert = require("node:assert/strict");
const test = require("node:test");
const load = () => import("../scripts/pstack-verifier.mjs");

test("both author lines are read, and family/model maps to the family", async () => {
  const { authorGate, authorFamily } = await load();
  assert.equal(authorGate("Author-Model: deepseek (deepseek-v4.1-flash)").author, "deepseek");
  assert.equal(authorGate("Author model: deepseek/deepseek-v4.1-flash").author, "deepseek");
  assert.equal(authorGate("author model: claude/claude-opus-5").author, "claude");
  assert.equal(authorGate("author-model: codex/gpt-6.1-sol").author, "codex");
  for (const family of ["claude", "deepseek", "grok", "codex", "other"]) {
    for (const key of ["AUTHOR-MODEL", "aUtHoR mOdEl"]) {
      assert.equal(authorGate(`${key}: ${family.toUpperCase()}/model`).author, family);
    }
  }
  assert.equal(authorGate("Author  model: grok").notes, "author model unknown");
  assert.equal(authorGate("Author model: mystery/whatever").notes, "author model unknown");
  assert.equal(authorGate("Author model: claude/claude-opus-5\n\nAuthor-Model: codex").notes, "author model unknown");
  const commit = { author: { login: "hypertask-runners[bot]" }, committer: { login: "hypertask-runners[bot]" }, commit: { message: "Fix the chat\n\nAuthor model: codex/gpt-6.1-sol" } };
  assert.equal(authorFamily("", [commit], "hypertask-runners[bot]"), "codex");
  assert.equal(authorFamily("Author model: deepseek/deepseek-v4.1-flash", [commit], "hypertask-runners[bot]"), "");
});

