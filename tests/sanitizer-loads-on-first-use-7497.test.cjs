const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function runInFreshNode(source) {
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production" },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split("\n").at(-1);
}

test("loading the ticket page sanitizer does not start jsdom until a comment is sanitized", () => {
  const report = JSON.parse(runInFreshNode(`
    const jiti = require("jiti")(${JSON.stringify(__filename)}, { interopDefault: true, alias: { "@": ${JSON.stringify(path.join(root, "src"))} } });
    const loaded = () => Object.keys(require.cache).filter(key => /node_modules[\\\\/](jsdom|isomorphic-dompurify)[\\\\/]/.test(key)).length;
    const { sanitizeAiHtml } = jiti(${JSON.stringify(path.join(root, "src/utils/helperFunctions/sanitizeHtml.ts"))});
    const atImport = loaded();
    const empty = sanitizeAiHtml("");
    const afterEmpty = loaded();
    const html = sanitizeAiHtml('<p onclick="alert(1)">safe</p>');
    console.log(JSON.stringify({ atImport, empty, afterEmpty, html, afterSanitize: loaded() }));
  `));
  assert.equal(report.atImport, 0, "2026-10-20: about 700 ms of jsdom start-up ran on every cold ticket page server (HTPR-7497)");
  assert.equal(report.empty, "");
  assert.equal(report.afterEmpty, 0);
  assert.equal(report.html, "<p>safe</p>");
  assert.ok(report.afterSanitize > 0);
});

test("the lazily loaded sanitizer returns exactly what the library returns with the same options", () => {
  const verdict = runInFreshNode(`
    const DOMPurify = require("isomorphic-dompurify");
    const jiti = require("jiti")(${JSON.stringify(__filename)}, { interopDefault: true, alias: { "@": ${JSON.stringify(path.join(root, "src"))} } });
    const { sanitizeAiHtml } = jiti(${JSON.stringify(path.join(root, "src/utils/helperFunctions/sanitizeHtml.ts"))});
    const options = { ADD_ATTR: ["data-type", "data-label", "data-id", "uniqueindex", "projectid", "target"] };
    const corpus = [
      '<p>Plain <strong>bold</strong> <em>italic</em></p>',
      '<span data-type="mention" data-id="42" data-label="Ana" projectid="15" uniqueindex="6847">@Ana</span>',
      '<a href="https://app.hypertask.ai/detail/project-15/1" target="_blank">link</a>',
      '<a href="javascript:alert(1)">bad</a><img src="x" onerror="alert(2)"><script>alert(3)</script>',
      '<ol class="numbered-list"><li><p>one</p></li><li><p>two</p></li></ol><pre><code>const a = 1;</code></pre>',
      '<table><tbody><tr><td>cell</td></tr></tbody></table><blockquote>quote</blockquote>',
      '<html><head></head><body><p>App-saved description</p></body></html>',
      '<iframe src="https://example.com"></iframe><svg><g onload="alert(4)"></g></svg>',
    ];
    const differences = corpus.filter(html => sanitizeAiHtml(html) !== DOMPurify.sanitize(html, options));
    console.log(differences.length === 0 ? "IDENTICAL" : "DIFFERENT " + JSON.stringify(differences));
  `);
  assert.equal(verdict, "IDENTICAL");
});
