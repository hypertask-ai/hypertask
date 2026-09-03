const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/stored-html-jiti-entry-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } }
  );
  return jiti(path.join(root, relativePath));
}

const { toStoredHtml } = loadTs("src/utils/helperFunctions/toStoredHtml.ts");

// WHY: this is what the AI chat actually persists into comments, drafts and task
// descriptions, all of which render through dangerouslySetInnerHTML. It has two jobs that
// pull against each other: force markdown into HTML, and do it without becoming an
// injection route. Ref HTPR-4687, and HTPR-4004 for the sanitizer.

test("markdown is converted on the way into storage", () => {
  const html = toStoredHtml("Thanks!\n\n- **INNE-1447**: offer call");
  assert.match(html, /<li><p><strong>INNE-1447<\/strong>: offer call<\/p><\/li>/);
  assert.ok(!html.includes("**"), `raw markdown was stored: ${html}`);
});

// Converting markdown turns [text](url) into a live anchor. Before conversion a
// javascript: URL was inert text, so the conversion itself is what makes sanitizing
// mandatory here rather than merely nice to have.
test("a javascript: markdown link cannot become a live href", () => {
  const html = toStoredHtml("[click](javascript:alert(1))");
  assert.ok(!html.includes("javascript:"), `javascript: URL survived: ${html}`);
});

test("raw model HTML is sanitized before storage", () => {
  const html = toStoredHtml(
    '<p onclick="alert(1)">Safe<script>alert(2)</script><a href="javascript:alert(3)">link</a></p>'
  );
  assert.equal(html, "<p>Safe<a>link</a></p>");
});

// This server route must use only the server-safe sanitizer. isomorphic-dompurify reaches
// jsdom, and pulling that into the chat route killed it at module load in production while
// every local check passed. The guard is the import graph itself, asserted below.
test("no browser-only dependency reaches the server route", () => {
  const fs = require("node:fs");
  const importsOf = (file) =>
    fs
      .readFileSync(path.join(root, file), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("import "))
      .join("\n");

  const banned = /sanitizeAiHtml|isomorphic-dompurify|sanitizeHtml|jsdom/;
  assert.ok(
    !banned.test(importsOf("src/utils/helperFunctions/toStoredHtml.ts")),
    "toStoredHtml must not import a DOMPurify-backed sanitizer (jsdom breaks the serverless route)"
  );
  assert.ok(
    !banned.test(importsOf("src/utils/helperFunctions/normalizeAssistantHtml.ts")),
    "normalizeAssistantHtml is in the same server import graph and has the same constraint"
  );
});

test("ordinary links still work", () => {
  assert.match(toStoredHtml("[docs](https://example.com)"), /href="https:\/\/example\.com"/);
});

// Sanitizing must preserve both structures produced by the markdown converter.
test("code blocks are not escaped into visible tags", () => {
  const html = toStoredHtml("```bash\nnpm i\n```");
  assert.match(html, /<pre><code class="language-bash">npm i/);
  assert.ok(!html.includes("&lt;code"), `the code tag was escaped into text: ${html}`);
});

test("task-list checkboxes survive", () => {
  assert.match(toStoredHtml("- [ ] todo"), /<input[^>]*type="checkbox"/);
});

// Mentions are resolved to spans before this runs. A stripped attribute here means a
// silently missing notification, which is worse than a visibly wrong comment.
test("mention spans keep the attributes the mention pipeline reads", () => {
  const html = toStoredHtml(
    '<span data-type="mention" class="mention" data-id="42" data-label="name-42">Val</span> hi'
  );
  assert.match(html, /data-type="mention"/);
  assert.match(html, /data-id="42"/);
  assert.match(html, /data-label="name-42"/);
});
