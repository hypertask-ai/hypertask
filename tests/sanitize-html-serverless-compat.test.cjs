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

test("the locked HTML sanitizer loads through its server entry point", () => {
  assert.equal(
    packageLock.packages["node_modules/isomorphic-dompurify"].version,
    packageJson.dependencies["isomorphic-dompurify"],
  );
  const DOMPurify = require("isomorphic-dompurify");
  assert.equal(
    DOMPurify.sanitize("<p>Server sanitizer</p>"),
    "<p>Server sanitizer</p>",
  );
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
      '<a href="javascript:alert(1)">unsafe</a>',
  );

  assert.match(sanitized, /data-type="mention"/);
  assert.match(sanitized, /projectid="15"/);
  assert.doesNotMatch(sanitized, /onclick|javascript:/i);
});
