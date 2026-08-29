const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { createPromptForTiptapForwardSlash } = jiti(
  path.join(root, "src/app/api/ai/_lib/editorAi.ts"),
);

test("ImproveReadability protects short content from destructive rewrite rules", () => {
  const prompt = createPromptForTiptapForwardSlash(
    "ImproveReadability",
    "<p>Please ship this fix today.</p>",
  );

  // HTPR-5587: short input gets the unslop pass only; no reshaping, no
  // compression, and the old house-style compression must stay gone.
  assert.match(prompt, /apply SKILL 1 \(unslop\) only/);
  assert.match(prompt, /preserve the original length, order, and tone/i);
  assert.doesNotMatch(prompt, /Cut the text length by 40-60%/);
  assert.doesNotMatch(prompt, /Bottom line up front/);
  assert.doesNotMatch(prompt, /Maximize brevity/);
});

test("ImproveReadability measures rendered text instead of HTML entity bytes", () => {
  const prompt = createPromptForTiptapForwardSlash(
    "ImproveReadability",
    `<p>${"x".repeat(117)} &amp;</p>`,
  );

  assert.match(prompt, /apply SKILL 1 \(unslop\) only/);
});

test("ImproveReadability keeps the full editing guidance for longer content", () => {
  const longText = `<p>${"Please review the implementation and confirm the rollout plan. ".repeat(4)}</p>`;
  const prompt = createPromptForTiptapForwardSlash(
    "ImproveReadability",
    longText,
  );

  // HTPR-5587 (Valentin, explicit): the prompt IS the two skill files
  // verbatim, unslop then i-have-adhd. Hand-curated summaries are the bug
  // this replaces; these markers come from the skill files themselves.
  assert.match(prompt, /=== SKILL 1: unslop ===/);
  assert.match(prompt, /Adding soul/);
  assert.match(prompt, /=== SKILL 2: i-have-adhd ===/);
  assert.match(prompt, /Lead with the next action/);
  assert.match(prompt, /Never invent facts, names, dates, estimates, or asks/);
  assert.doesNotMatch(prompt, /Cut the text length by 40-60%/);
  assert.doesNotMatch(prompt, /Maximize brevity/);
});

test("ImproveReadability switches branches at the exact minimum length", () => {
  const prompt = createPromptForTiptapForwardSlash(
    "ImproveReadability",
    `<p>${"x".repeat(120)}</p>`,
  );

  assert.match(prompt, /=== SKILL 2: i-have-adhd ===/);
});
