const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const report = "<h1>QA report</h1><table><thead><tr><th>Case</th><th>Result</th></tr></thead>" +
  "<tbody><tr><td>Clear the marker</td><td>PASS</td></tr><tr><td>Cell | pipe</td><td>PASS</td></tr></tbody></table>" +
  "<pre><code>hypertask pages get 1</code></pre>";

test("HTPR-8435 page export tables is a reversible bugfix for everyone", () => {
  const { default: flag } = loadModule("src/lib/flags/definitions/htpr-8435-page-export-tables.ts");
  assert.equal(flag.key, "htpr-8435-page-export-tables");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("a markdown read of an HTML page keeps its table and code block", () => {
  const { htmlToMarkdownWithTables } = loadModule("src/utils/controllers/pages/htmlToMarkdown.ts");
  const markdown = htmlToMarkdownWithTables(report);
  assert.match(markdown, /^\| Case\s+\| Result \|$/m);
  assert.match(markdown, /^\| ---\s+\| ---\s+\|$/m);
  assert.match(markdown, /^\| Clear the marker \| PASS \|$/m);
  assert.match(markdown, /^\| Cell \\\| pipe \| PASS \|$/m);
  assert.match(markdown, /```\nhypertask pages get 1\n```/);
});

test("the table export renders back to the same cells", () => {
  const { htmlToMarkdownWithTables } = loadModule("src/utils/controllers/pages/htmlToMarkdown.ts");
  const { markdownToHtml } = loadModule("src/utils/helperFunctions/markdownToHtml.ts");
  const html = markdownToHtml(htmlToMarkdownWithTables(report));
  for (const cell of ["Case", "Result", "Clear the marker", "PASS", "Cell | pipe"]) {
    assert.ok(html.includes(`<td>${cell}</td>`) || html.includes(`<th>${cell}</th>`), `${cell} survived the round trip`);
  }
  assert.equal((html.match(/<tr>/g) ?? []).length, 3);
});

test("a table caption and a nested table keep their text without extra columns", () => {
  const { htmlToMarkdownWithTables } = loadModule("src/utils/controllers/pages/htmlToMarkdown.ts");
  const markdown = htmlToMarkdownWithTables(
    '<table><caption>All amounts in USD</caption><thead><tr><th>Case</th><th>Result</th></tr></thead>' +
    '<tbody><tr><td>Outer</td><td><table><tr><th>In</th><th>Val</th></tr></table></td></tr></tbody></table>'
  );
  assert.match(markdown, /^All amounts in USD$/m);
  assert.match(markdown, /^\| Case \| Result \|$/m);
  const rows = markdown.split("\n").filter((line) => line.startsWith("|"));
  assert.equal(rows.length, 3);
  assert.match(rows[2], /^\| Outer \| \\?\| In/);
  assert.equal((rows[2].match(/(?<!\\)\|/g) ?? []).length, 3);
});

test("the old export still flattens tables so the flag can revert it", () => {
  const { htmlToMarkdown } = loadModule("src/utils/controllers/pages/htmlToMarkdown.ts");
  const markdown = htmlToMarkdown(report);
  assert.doesNotMatch(markdown, /\| Case/);
  assert.match(markdown, /Clear the marker/);
});

test("the page read picks the table export only while the flag is on", () => {
  const source = read("src/lib/mcp/operations/pages/get/operation.ts");
  assert.match(source, /await isFeatureEnabled\('htpr-8435-page-export-tables', ctx\.user\.id\)/);
  assert.match(source, /keepTables[\s\S]{0,160}htmlToMarkdownWithTables\(page\.contentHtml\)[\s\S]{0,120}htmlToMarkdown\(page\.contentHtml\)/);
});

test("create names the page type it stored", () => {
  const source = read("src/lib/mcp/operations/pages/create/operation.ts");
  assert.match(source, /const storedContentType = await storedPageContentType\(/);
  assert.match(source, /content_type: storedContentType,/);
});
