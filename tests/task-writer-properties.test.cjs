const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(__dirname, "task-writer-properties.test.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") } }
);
const { extractTaskWriterProperties } = jiti(
  path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts")
);
const { extractTitleAndDescription } = jiti(
  path.join(root, "src/utils/aiWriterUtils.ts")
);

// The CLI writes these fields onto the task itself. If the markers leaked into
// the description instead, a CLI-written ticket would show "Priority: High" as
// body text while the priority field stayed empty - the exact mismatch with the
// UI's Accept that this extraction exists to prevent.
test("splits title, priority and size out of the description", () => {
  const html = [
    '<h1 id="ai-generated-task-title">Fix the nightly sync</h1>',
    '<p>Priority: <strong>High</strong><span id="ai-generated-task-priority" style="display:none">2</span></p>',
    '<p>Size: <strong>S</strong><span id="ai-generated-task-estimate" style="display:none">3</span></p>',
    "<p>Archived boards are skipped without a warning.</p>",
  ].join("\n");

  const result = extractTaskWriterProperties(html);

  assert.equal(result.title, "Fix the nightly sync");
  assert.equal(result.priority, 2);
  assert.equal(result.estimate, 3);
  assert.match(result.description, /Archived boards are skipped/);
  assert.doesNotMatch(result.description, /ai-generated-task/);
  assert.doesNotMatch(result.description, /Priority:/);
  assert.doesNotMatch(result.description, /Size:/);
});

test("description-only takeover removes hidden task property markers", () => {
  const previousDOMParser = global.DOMParser;
  global.DOMParser = new JSDOM("").window.DOMParser;
  try {
    const html = [
      '<h1 id="ai-generated-task-title">Verify automatic planning draft</h1>',
      "<p>Verify the automatic planning draft generated for this task.</p>",
      '<p>Proposed properties: Priority <strong>Urgent</strong>, Size <strong>S</strong>' +
        '<span id="ai-generated-task-priority" style="display:none">1</span>' +
        '<span id="ai-generated-task-estimate" style="display:none">3</span></p>',
    ].join("");

    const result = extractTitleAndDescription(html);

    assert.equal(result.title, "Verify automatic planning draft");
    assert.match(result.description, /Priority <strong>Urgent<\/strong>, Size <strong>S<\/strong>/);
    assert.doesNotMatch(result.description, /ai-generated-task|>1<|>3</);
  } finally {
    global.DOMParser = previousDOMParser;
  }
});

test("leaves plain output untouched and reports no properties", () => {
  const html = "<p>Arrr, the sync job be fixed.</p>";
  const result = extractTaskWriterProperties(html);

  assert.equal(result.title, null);
  assert.equal(result.priority, undefined);
  assert.equal(result.estimate, undefined);
  assert.equal(result.description, html);
});

// The CLI writes whatever comes back straight onto the task. An index outside the
// real Priority/Estimate sets would be rejected by the update API and take the
// whole --apply down with it, so it must not escape the extractor.
test("drops priority and size indexes outside the real ranges", () => {
  const html = [
    '<h1 id="ai-generated-task-title">Bogus indexes</h1>',
    '<p>Priority: <span id="ai-generated-task-priority" style="display:none">99</span></p>',
    '<p>Size: <span id="ai-generated-task-estimate" style="display:none">-3</span></p>',
    "<p>Body text.</p>",
  ].join("\n");

  const result = extractTaskWriterProperties(html);

  assert.equal(result.priority, undefined);
  assert.equal(result.estimate, undefined);
  assert.doesNotMatch(result.description, /ai-generated-task/);
});

// A model that answers with a whole document would otherwise leave the shell in
// the description and hide the property lines from the leading-child scan.
test("unwraps a full HTML document before extracting", () => {
  const html = [
    "<!doctype html><html><head><title>x</title></head><body>",
    '<h1 id="ai-generated-task-title">Wrapped output</h1>',
    '<p>Priority: <strong>High</strong><span id="ai-generated-task-priority" style="display:none">2</span></p>',
    "<p>The real body.</p>",
    "</body></html>",
  ].join("\n");

  const result = extractTaskWriterProperties(html);

  assert.equal(result.title, "Wrapped output");
  assert.equal(result.priority, 2);
  assert.match(result.description, /The real body/);
  assert.doesNotMatch(result.description, /<body|<html|Priority:/);
});

// Only leading property lines are chrome. A "Priority:" sentence further down is
// the user's own content and must survive.
test("keeps property-looking text that appears inside the body", () => {
  const html = [
    '<h1 id="ai-generated-task-title">Triage rules</h1>',
    "<p>The rule is simple.</p>",
    "<p>Priority: whatever the reporter says.</p>",
  ].join("\n");

  const result = extractTaskWriterProperties(html);

  assert.equal(result.title, "Triage rules");
  assert.match(result.description, /whatever the reporter says/);
});
