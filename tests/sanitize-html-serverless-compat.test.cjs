const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const createJiti = require("jiti");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);

test("the HTML sanitizer stays on the serverless-compatible dependency path", () => {
  assert.equal(packageJson.dependencies["isomorphic-dompurify"], "2.26.0");
  assert.equal(
    packageLock.packages["node_modules/isomorphic-dompurify"].version,
    "2.26.0",
  );
  assert.equal(packageLock.packages["node_modules/jsdom"].version, "26.1.0");
  assert.equal(
    packageLock.packages["node_modules/html-encoding-sniffer"].version,
    "4.0.0",
  );
  assert.equal(packageLock.packages["node_modules/@exodus/bytes"], undefined);
});

test("the pinned sanitizer loads on the server and preserves its XSS contract", () => {
  const jiti = createJiti(__filename, {
    alias: { "@": path.join(root, "src") },
  });
  const { sanitizeAiHtml, sanitizeRenderedRichHtml } = jiti(
    path.join(root, "src/utils/helperFunctions/sanitizeHtml.ts"),
  );

  const sanitized = sanitizeAiHtml(
    '<span data-type="mention" projectid="15" onclick="alert(1)">Task</span>' +
      '<a href="javascript:alert(1)">unsafe</a>',
  );

  assert.match(sanitized, /data-type="mention"/);
  assert.match(sanitized, /projectid="15"/);
  assert.doesNotMatch(sanitized, /onclick|javascript:/i);

  const richText = sanitizeRenderedRichHtml(
    '<video controls style="width: 100%" media-type="video"><source src="https://cdn.example.com/demo.mp4"></video>' +
      '<iframe src="https://www.youtube.com/embed/demo" onload="alert(1)"></iframe>' +
      '<iframe src="https://evil.example/embed/demo"></iframe>' +
      '<img src="x" onerror="alert(1)"><script>alert(1)</script>',
  );

  assert.match(richText, /<video/);
  assert.match(richText, /<source src="https:\/\/cdn\.example\.com\/demo\.mp4">/);
  assert.match(richText, /<iframe[^>]+src="https:\/\/www\.youtube\.com\/embed\/demo"/);
  assert.match(richText, /sandbox="allow-scripts allow-same-origin allow-presentation"/);
  assert.doesNotMatch(richText, /evil\.example|onload|onerror|<script/i);
});
