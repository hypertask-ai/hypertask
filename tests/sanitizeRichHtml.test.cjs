// HTPR-5173: pre/code blocks must not be mangled by sanitizeRichHtml
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, "tests/recurrence-entry.cjs"), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, relativePath));
}

const { sanitizeRichHtml } = loadTs("src/utils/helperFunctions/sanitizeRichHtml.ts");

test("preserves <pre><code> blocks", () => {
  const input = '<pre><code class="language-bash">echo hello</code></pre>';
  const result = sanitizeRichHtml(input);
  assert.equal(result, input);
});

test("escapes special chars inside <pre><code>", () => {
  const result = sanitizeRichHtml('<pre><code>if (x < 10) { return true; }</code></pre>');
  assert.ok(result.includes('&lt;'));
  assert.ok(result.includes('</code></pre>'));
});

test("strips xss inside <pre> blocks", () => {
  const result = sanitizeRichHtml('<pre><code>evil<script>alert(1)</script></code></pre>');
  assert.ok(!result.includes('<script>'));
  assert.ok(!result.includes('alert(1)'));
});

test("preserves plain text in <pre>", () => {
  const input = '<pre>plain text</pre>';
  assert.equal(sanitizeRichHtml(input), input);
});

test("does not double-escape escaped entities in <pre>", () => {
  const input = '<pre><code>&lt;div&gt;</code></pre>';
  const result = sanitizeRichHtml(input);
  assert.equal(result, input);
});

test("does not rewrite a user-supplied old sentinel into <pre>", () => {
  assert.equal(sanitizeRichHtml("<x-pr3>user text</x-pr3>"), "user text");
});

test("chooses another sentinel when the default occurs in user input", () => {
  const result = sanitizeRichHtml(
    "<x-ht-pre>user text</x-ht-pre><pre><code>npm test</code></pre>",
  );

  assert.equal(result, "user text<pre><code>npm test</code></pre>");
});

test("does not rewrite pre-like text in allowed attributes", () => {
  const input = '<a title="Use <pre> here">x</a>';

  assert.equal(
    sanitizeRichHtml(input),
    '<a title="Use &lt;pre&gt; here">x</a>',
  );
});

test("still recognizes pre tags after a literal less-than character", () => {
  assert.equal(sanitizeRichHtml("2 < 3<pre>code</pre>"), "2 &lt; 3<pre>code</pre>");
});
