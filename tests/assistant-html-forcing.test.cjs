const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/assistant-html-jiti-entry-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } }
  );
  return jiti(path.join(root, relativePath));
}

const { normalizeAssistantHtml } = loadTs(
  "src/utils/helperFunctions/normalizeAssistantHtml.ts"
);


test("markdown is converted, not passed through as literal asterisks", () => {
  const html = normalizeAssistantHtml(
    "Thanks!\n\n- **INNE-1447**: offer call\n- INNE-1448: trust signal"
  );
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>INNE-1447<\/strong>/);
  assert.ok(!html.includes("**"), `raw markdown survived: ${html}`);
});

test("a mixed HTML + markdown response converts the markdown and keeps the HTML", () => {
  const html = normalizeAssistantHtml(
    "<p>Thanks Hicham!</p>\n\nHere are the tests:\n- **INNE-1447**: offer call"
  );
  assert.match(html, /<p>Thanks Hicham!<\/p>/);
  assert.match(html, /<li><strong>INNE-1447<\/strong>: offer call<\/li>/);
  assert.ok(!html.includes("**"), `raw markdown survived: ${html}`);
});

test("HTML that is already correct is left alone", () => {
  const source = "<p>Thanks!</p>\n<ul><li><strong>INNE-1447</strong>: offer</li></ul>";
  assert.equal(normalizeAssistantHtml(source), source);
});

test("a whole-string ```html fence is unwrapped rather than rendered as code", () => {
  const html = normalizeAssistantHtml("```html\n<p>hello</p>\n```");
  assert.equal(html, "<p>hello</p>");
  assert.ok(!html.includes("<code"), `fence was rendered as code: ${html}`);
});

test("a message containing two code blocks keeps both, and the prose between them", () => {
  const html = normalizeAssistantHtml(
    "```bash\nnpm install\n```\n\nThen run:\n\n```bash\nnpm test\n```"
  );
  assert.equal((html.match(/<pre>/g) || []).length, 2);
  assert.match(html, /<p>Then run:<\/p>/);
  assert.ok(!html.includes("```"), `a raw fence marker leaked: ${html}`);
});

test("a non-html fence stays a code block instead of being unwrapped", () => {
  const html = normalizeAssistantHtml("```bash\nnpm i\n```");
  assert.match(html, /<pre><code class="language-bash">npm i/);
});

test("indented HTML is not escaped into a visible code block", () => {
  const html = normalizeAssistantHtml("<p>intro</p>\n\n    <p>indented</p>");
  assert.ok(!html.includes("&lt;p&gt;"), `HTML was escaped into text: ${html}`);
  assert.ok(!html.includes("<code"), `HTML became a code block: ${html}`);
});

test("task-list checkboxes survive as checkboxes", () => {
  const html = normalizeAssistantHtml("- [ ] todo\n- [x] done");
  assert.match(html, /<input[^>]*type="checkbox"/);
  assert.match(html, /<input checked/);
});

test("an already-resolved @mention span passes through untouched", () => {
  const span =
    '<span data-type="mention" class="mention" data-id="42" data-label="O\'Brien">O\'Brien</span>';
  const html = normalizeAssistantHtml(`${span} please look\n\n- **item**`);
  assert.match(html, /data-type="mention"/);
  assert.match(html, /data-id="42"/);
  assert.match(html, /<strong>item<\/strong>/);
});

test("a CRLF ```html fence is still unwrapped", () => {
  assert.equal(normalizeAssistantHtml("```html\r\n<p>hi</p>\r\n```"), "<p>hi</p>");
});

test("a fence with a trailing space after the language is still unwrapped", () => {
  assert.equal(normalizeAssistantHtml("```html \n<p>hi</p>\n```"), "<p>hi</p>");
});

test("bare text is still wrapped in a block tag", () => {
  assert.equal(normalizeAssistantHtml("just one plain line"), "<p>just one plain line</p>");
});

test("empty input stays empty instead of becoming an empty paragraph", () => {
  assert.equal(normalizeAssistantHtml(""), "");
  assert.equal(normalizeAssistantHtml("   \n  "), "");
});
