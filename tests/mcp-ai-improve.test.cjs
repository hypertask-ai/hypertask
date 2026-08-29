const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/mcp-ai-improve.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { toEditableHtml } = jiti(
  path.join(root, "src/app/api/mcp/ai/improve/plainText.ts")
);
// The real schema the route uses (kept in its own zero-import file precisely
// so this test can import it directly instead of a copy that can drift).
const { requestSchema } = jiti(
  path.join(root, "src/app/api/mcp/ai/improve/schema.ts")
);

test("plain text gets wrapped in an escaped <p>", () => {
  const result = toEditableHtml("fix this < & > text");
  assert.equal(result, "<p>fix this &lt; &amp; &gt; text</p>");
});

test("text that already has HTML tags is left alone", () => {
  const html = "<p>already <strong>rich</strong> text</p>";
  assert.equal(toEditableHtml(html), html);
});

test("stray angle brackets in prose are not mistaken for HTML", () => {
  for (const text of [
    "a<b and c>d",
    "<username>",
    "Alice <alice@example.com>",
  ]) {
    const result = toEditableHtml(text);
    assert.ok(
      result.startsWith("<p>") && result.endsWith("</p>"),
      `expected ${JSON.stringify(text)} to be wrapped as plain text, got ${result}`
    );
    // Wrapped AND escaped: no raw "<" or ">" survives except the <p>/</p> we added.
    const inner = result.slice("<p>".length, -"</p>".length);
    assert.ok(!inner.includes("<") && !inner.includes(">"), `expected ${result} to be fully escaped`);
  }
});

test("schema rejects an unknown command", () => {
  assert.throws(() =>
    requestSchema.parse({ project_id: 1, text: "hi", command: "TranslateToFrench" })
  );
});

test("schema accepts Translate:<Language>", () => {
  const parsed = requestSchema.parse({
    project_id: 1,
    text: "hi",
    command: "Translate:German",
  });
  assert.equal(parsed.command, "Translate:German");
});

test("schema rejects a Translate command with junk after the language", () => {
  assert.throws(() =>
    requestSchema.parse({
      project_id: 1,
      text: "hi",
      command: "Translate:German; DROP TABLE users",
    })
  );
});

test("schema rejects an unknown key", () => {
  assert.throws(() =>
    requestSchema.parse({ project_id: 1, text: "hi", extra: "nope" })
  );
});

test("schema defaults command to ImproveReadability", () => {
  const parsed = requestSchema.parse({ project_id: 1, text: "hi" });
  assert.equal(parsed.command, "ImproveReadability");
});

test("schema requires project_id", () => {
  assert.throws(() => requestSchema.parse({ text: "hi" }));
});
