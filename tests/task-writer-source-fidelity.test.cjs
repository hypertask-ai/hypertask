const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { createKanbanSystemPrompt } = jiti(
  path.join(root, "src/app/api/ai/_lib/editorAi.ts"),
);

// HTPR-5606: a demo run regenerated INNE-1576 and invented eight headline
// lines the brief never contained (95 words, 73% of the length growth). The
// task writer AUTHORS rather than rewrites, so it needs the fidelity rules
// the Improve button does not.
for (const mode of ["task_writer", "write_with_ai"]) {
  test(`${mode} runs the two skills verbatim`, () => {
    const prompt = createKanbanSystemPrompt(mode);
    assert.match(prompt, /=== SKILL 1: unslop ===/);
    assert.match(prompt, /Adding soul/);
    assert.match(prompt, /=== SKILL 2: i-have-adhd ===/);
    assert.match(prompt, /Lead with the next action/);
  });

  test(`${mode} forbids writing content the brief lacks`, () => {
    const prompt = createKanbanSystemPrompt(mode);
    assert.match(prompt, /SOURCE FIDELITY/);
    assert.match(prompt, /Adding one it never wrote is a defect/);
    assert.match(prompt, /never resolve it to a calendar date/);
  });

  test(`${mode} forbids dropping content the brief has`, () => {
    const prompt = createKanbanSystemPrompt(mode);
    assert.match(prompt, /Losing content is worse than padding/);
    assert.match(prompt, /never in place of content the source did give you/);
  });

  test(`${mode} lets a board template outrank brevity`, () => {
    const prompt = createKanbanSystemPrompt(mode);
    assert.match(prompt, /PRECEDENCE when rules conflict/);
    assert.match(prompt, /never a reason to drop a section the template requires/);
  });
}

test("task_writer keeps its structured-output contract", () => {
  const prompt = createKanbanSystemPrompt("task_writer");
  assert.match(prompt, /ai-generated-task-title/);
  assert.match(prompt, /HT_MEDIA_1/);
});

test("task_writer preserves raw screenshot URLs instead of inventing media tokens", () => {
  const prompt = createKanbanSystemPrompt("task_writer");
  assert.match(prompt, /media token is valid ONLY when that exact token appears in the input/);
  assert.match(prompt, /raw screenshot or image URL is a link, not a media token/);
  assert.match(prompt, /NEVER replace a raw URL with an HT_MEDIA token/);
});

test("write_with_ai still writes in the user's voice, not the assistant's", () => {
  const prompt = createKanbanSystemPrompt("write_with_ai");
  assert.match(prompt, /You ARE the user/);
  assert.match(prompt, /This is NOT a chat/);
});
