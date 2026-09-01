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

test("ImproveReadability uses the Structured prompt for every input length", () => {
  for (const input of [
    "<p>Please ship this fix today.</p>",
    `<p>${"Please review the implementation and confirm the rollout plan. ".repeat(4)}</p>`,
  ]) {
    const improve = createPromptForTiptapForwardSlash(
      "ImproveReadability",
      input,
    );
    const structured = createPromptForTiptapForwardSlash("Structured", input);

    assert.equal(improve, structured);
    assert.match(improve, /Restructure for an ADHD reader/i);
    assert.match(improve, /numbered steps for multi-step work/i);
    assert.match(improve, /ONLY rewriting existing text/i);
    assert.match(improve, /Reproduce EVERY <img>, video, iframe, audio, and embed/i);
    assert.match(improve, /Keep all links from the input intact/i);
    assert.doesNotMatch(improve, /apply SKILL 1 \(unslop\) only/i);
  }
});
