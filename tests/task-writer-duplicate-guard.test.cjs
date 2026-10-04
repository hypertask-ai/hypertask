// HTPR-6721: the AI Task Writer answered "ab test new woman on hero against ai
// image" with a "Possible duplicate" note instead of a task, and Accept ALL (or
// the CLI) saved it as a ticket titled "Possible duplicate". These tests pin
// the guard: the writer writes the requested task like normal, and a similar
// earlier ticket (an earlier test) only appears under "Related tickets".
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(__dirname, "task-writer-duplicate-guard.test.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") } }
);
const {
  isDuplicateNoteTitle,
  repairDuplicateNote,
  taskTitleFromBrief,
} = jiti(path.join(root, "src/lib/ai/taskWriterDuplicateGuard.ts"));
const { extractTaskWriterProperties } = jiti(
  path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts")
);
const { extractTaskProperties, extractTitleAndDescription } = jiti(
  path.join(root, "src/utils/aiWriterUtils.ts")
);

const BRIEF = "ab test new woman on hero against ai image";
const RELATED_SECTION = () =>
  `<h2>Related tickets</h2><ul><li><p>${INNE_944_LINK}: similar earlier ticket.</p></li></ul>`;
const INNE_944_LINK =
  '<a href="https://app.hypertask.ai/detail/project-339/944">INNE-944, [HOME] [E] Hero model image swap test</a>';
// The exact shape from the screenshot on HTPR-6721.
const DUPLICATE_NOTE = [
  '<h1 id="ai-generated-task-title">Possible duplicate</h1>',
  `<p>This may match ${INNE_944_LINK}.</p>`,
  "<p>How this request differs from INNE-944: Not provided.</p>",
  "<p>Proposed properties: Priority <strong>High</strong>, Size <strong>S</strong>" +
    '<span id="ai-generated-task-priority" style="display:none">2</span>' +
    '<span id="ai-generated-task-estimate" style="display:none">3</span></p>',
].join("\n");

function withDom(run) {
  const previous = global.DOMParser;
  global.DOMParser = new JSDOM("").window.DOMParser;
  try {
    return run();
  } finally {
    global.DOMParser = previous;
  }
}

test("recognises duplicate-note titles and leaves real duplicate tasks alone", () => {
  for (const title of [
    "Possible duplicate",
    "possible duplicate of INNE-944",
    "Likely duplicate of INNE-944, Hero model image swap test",
    "Duplicate: HTPR-6686",
    "Duplicate",
    "Duplicate of HTPR-6686",
  ]) {
    assert.equal(isDuplicateNoteTitle(title), true, title);
  }
  for (const title of [
    "Potential duplicate charges when retrying checkout",
    "Possible duplicate: hero test",
    "Fix duplicate notifications",
    "Duplicate board action",
    "Deduplicate export rows",
    "Duplicate task button does nothing",
    "A/B test new woman on hero against AI image",
    "",
    null,
  ]) {
    assert.equal(isDuplicateNoteTitle(title), false, String(title));
  }
});

test("server extractor: title is the requested task, the match sits under Related tickets", () => {
  const result = extractTaskWriterProperties(DUPLICATE_NOTE, {
    fallbackTitle: taskTitleFromBrief(BRIEF),
  });

  assert.equal(result.title, "Ab test new woman on hero against ai image");
  assert.doesNotMatch(result.title, /duplicate/i);
  assert.equal(result.priority, 2);
  assert.equal(result.estimate, 3);
  assert.equal(result.description, RELATED_SECTION());
  assert.doesNotMatch(result.description, /Not provided|duplicate|differs/i);
});

test("server extractor without a fallback drops the title instead of saving the note", () => {
  const result = extractTaskWriterProperties(DUPLICATE_NOTE);
  assert.equal(result.title, null);
  assert.doesNotMatch(result.description, /Possible duplicate/);
});

test("browser Accept ALL and Accept title never take the duplicate note as title", () =>
  withDom(() => {
    const repaired = repairDuplicateNote(
      DUPLICATE_NOTE,
      taskTitleFromBrief("new woman in hero")
    );
    const all = extractTaskProperties(repaired);
    assert.equal(all.title, "New woman in hero");
    assert.equal(all.description.trim(), RELATED_SECTION());
    assert.doesNotMatch(all.description, /Not provided|duplicate/i);

    // Even unrepaired output cannot hand "Possible duplicate" to the title field.
    assert.equal(extractTaskProperties(DUPLICATE_NOTE).title, null);
    assert.equal(extractTitleAndDescription(DUPLICATE_NOTE).title, null);
  }));

test("a real draft about duplicate charges keeps its own title", () => {
  const draft =
    '<h1 id="ai-generated-task-title">Potential duplicate charges when retrying checkout</h1><p>Retrying charges twice.</p>';
  assert.equal(repairDuplicateNote(draft, "Anything"), draft);
  assert.equal(
    extractTaskWriterProperties(draft).title,
    "Potential duplicate charges when retrying checkout"
  );
});

test("plain text decoding does not double-unescape ampersands", () => {
  const html =
    '<h1 id="ai-generated-task-title">Possible duplicate</h1><p>x</p>';
  assert.equal(taskTitleFromBrief("fix &amp;lt;b&amp;gt; tags"), "Fix &lt;b&gt; tags");
  assert.match(repairDuplicateNote(html, "t"), /<h1 id="ai-generated-task-title">t<\/h1>/);
});

test("a normal draft passes through byte for byte", () => {
  const draft = [
    '<h1 id="ai-generated-task-title">A/B test new hero model against AI image</h1>',
    "<h2>Problem</h2><p>Test the new model photo on the hero.</p>",
    '<h2>Related tickets</h2><ul><li><p><a href="https://app.hypertask.ai/detail/project-339/944">INNE-944</a>: earlier test of the hero image.</p></li></ul>',
    "<p>Proposed properties: Priority <strong>High</strong></p>",
  ].join("\n");
  assert.equal(repairDuplicateNote(draft, "Anything"), draft);
  assert.equal(
    extractTaskWriterProperties(draft, { fallbackTitle: "Anything" }).title,
    "A/B test new hero model against AI image"
  );
});

test("a fallback title with $ patterns is inserted literally and escaped", () => {
  const repaired = repairDuplicateNote(DUPLICATE_NOTE, "Cut $& <fees>");
  assert.match(repaired, /<h1 id="ai-generated-task-title">Cut \$&amp; &lt;fees&gt;<\/h1>/);
});

test("titles from briefs use the first line and stay short", () => {
  assert.equal(taskTitleFromBrief("  new woman in hero\nmore detail"), "New woman in hero");
  assert.equal(taskTitleFromBrief("<p>fix login</p>"), "Fix login");
  assert.equal(taskTitleFromBrief(""), null);
  assert.equal(taskTitleFromBrief("Possible duplicate"), null);
  const long = taskTitleFromBrief("word ".repeat(40));
  assert.ok(long.length <= 80, long);
});

test("board research rules no longer tell the writer to replace the draft", () => {
  const { TASK_WRITER_BOARD_RESEARCH_RULES: source } = jiti(
    path.join(root, "src/app/api/ai/_lib/taskWriterBoardResearch.ts")
  );
  assert.doesNotMatch(source, /stop drafting/i);
  assert.doesNotMatch(source, /<h1 id="ai-generated-task-title">Possible duplicate/);
  assert.doesNotMatch(source, /duplicate warning/i);
  assert.match(source, /ALWAYS write the full task the person asked for, like normal/);
  assert.match(source, /Never write "Not provided\." in this writer/);
  assert.match(source, /it goes in Related tickets only/);
});
