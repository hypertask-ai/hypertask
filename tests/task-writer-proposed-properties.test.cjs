const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

// HTPR-5606: "Priority: Medium" / "Size: S" lines used to print near the TOP
// of the description, disturbing to read. They now land as a single
// "Proposed properties: ..." paragraph at the END of the output.
const { createTaskWriterSystemPromptTemplate } = jiti(
  path.join(root, "src/app/api/ai/_lib/taskWriterPrompt.ts"),
);
const { extractTaskWriterProperties } = jiti(
  path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts"),
);

test("prompt template puts properties in one trailing 'Proposed properties' paragraph", () => {
  const prompt = createTaskWriterSystemPromptTemplate("");
  assert.match(prompt, /Proposed properties/);
  assert.match(prompt, /LAST element of the entire output/);
  assert.doesNotMatch(prompt, /<p>Priority: <strong>/);
});

test("extraction pulls priority/estimate from the trailing combined line and removes it", () => {
  const html = [
    '<h1 id="ai-generated-task-title">Fix Login Form Timeout Issue</h1>',
    "<p>Real body content that must survive.</p>",
    "<ul><li>Detail one</li><li>Detail two</li></ul>",
    '<p>Proposed properties: Priority <strong>High</strong>, Size <strong>S</strong>' +
      '<span id="ai-generated-task-priority" style="display:none">2</span>' +
      '<span id="ai-generated-task-estimate" style="display:none">3</span></p>',
  ].join("");

  const result = extractTaskWriterProperties(html);
  assert.equal(result.priority, 2);
  assert.equal(result.estimate, 3);
  assert.match(result.description, /Real body content that must survive/);
  assert.match(result.description, /Detail one/);
  assert.doesNotMatch(result.description, /Proposed properties/);
});

test("old-style leading 'Priority:' line is still stripped (backward compat)", () => {
  const html = [
    '<h1 id="ai-generated-task-title">Old style task</h1>',
    '<p>Priority: <strong>High</strong>' +
      '<span id="ai-generated-task-priority" style="display:none">2</span></p>',
    "<p>Real body content.</p>",
  ].join("");

  const result = extractTaskWriterProperties(html);
  assert.equal(result.priority, 2);
  assert.doesNotMatch(result.description, /Priority:/);
  assert.match(result.description, /Real body content/);
});

test("a paragraph that merely starts with the word 'Priority' but is real content is kept", () => {
  const html = [
    '<h1 id="ai-generated-task-title">Ship the release</h1>',
    "<p>Priority is to ship before Friday.</p>",
    "<p>Second paragraph with more detail.</p>",
  ].join("");

  const result = extractTaskWriterProperties(html);
  assert.equal(result.priority, undefined);
  assert.match(result.description, /Priority is to ship before Friday\./);
  assert.match(result.description, /Second paragraph with more detail/);
});
