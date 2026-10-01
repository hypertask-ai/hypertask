const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const createJiti = require("jiti");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);

test("the HTML sanitizer stays on the serverless-compatible dependency path", () => {
  assert.equal(packageJson.engines.node, "24.x");
  assert.equal(packageJson.dependencies["isomorphic-dompurify"], "4.4.0");
  assert.equal(
    packageLock.packages["node_modules/isomorphic-dompurify"].version,
    "4.4.0",
  );
  // The sanitizer uses its nested jsdom, not the root test-only jsdom 26.
  assert.equal(
    packageLock.packages["node_modules/isomorphic-dompurify/node_modules/jsdom"].version,
    "30.1.1",
  );
  assert.equal(
    packageLock.packages["node_modules/isomorphic-dompurify/node_modules/html-encoding-sniffer"].version,
    "7.0.0",
  );
  assert.equal(packageLock.packages["node_modules/@exodus/bytes"].version, "1.16.0");
});

test("the pinned sanitizer loads in a fresh server process without a browser or transpiler", () => {
  const sanitized = execFileSync(process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    assert.equal(typeof window, "undefined");
    assert.equal(typeof document, "undefined");
    const DOMPurify = require("isomorphic-dompurify");
    process.stdout.write(DOMPurify.sanitize('<p>Server HTML</p><script>alert(1)</script>'));
  `], { cwd: root, encoding: "utf8" });

  assert.equal(sanitized, "<p>Server HTML</p>");
});

test("the pinned sanitizer loads on the server and preserves its XSS contract", () => {
  const jiti = createJiti(__filename, {
    alias: { "@": path.join(root, "src") },
  });
  const { sanitizeAiHtml } = jiti(
    path.join(root, "src/utils/helperFunctions/sanitizeHtml.ts"),
  );

  const sanitized = sanitizeAiHtml(
    '<span data-type="mention" projectid="15" onclick="alert(1)">Task</span>' +
      '<a href="javascript:alert(1)">unsafe</a>' +
      '<script>alert(1)</script><img src="x" onerror="alert(1)">' +
      '<p><strong>Safe formatting</strong><a href="https://app.hypertask.ai">safe link</a></p>',
  );

  assert.match(sanitized, /data-type="mention"/);
  assert.match(sanitized, /projectid="15"/);
  assert.doesNotMatch(sanitized, /<script|onclick|onerror|javascript:|alert\(1\)/i);
  assert.match(sanitized, /<strong>Safe formatting<\/strong>/);
  assert.match(sanitized, /href="https:\/\/app\.hypertask\.ai"/);
  assert.equal(sanitizeAiHtml(""), "");
});
