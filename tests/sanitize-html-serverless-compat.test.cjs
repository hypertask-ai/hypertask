const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const createJiti = require("jiti");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);

test("the HTML sanitizer stays on the serverless-compatible dependency path", () => {
  assert.equal(packageJson.dependencies["isomorphic-dompurify"], "4.4.0");
  assert.equal(
    packageLock.packages["node_modules/isomorphic-dompurify"].version,
    "4.4.0",
  );
  assert.equal(packageJson.overrides["isomorphic-dompurify"].jsdom, "26.1.0");
  assert.equal(
    packageLock.packages["node_modules/isomorphic-dompurify/node_modules/jsdom"],
    undefined,
  );
  assert.equal(packageLock.packages["node_modules/jsdom"].version, "26.1.0");
  assert.equal(
    packageLock.packages["node_modules/html-encoding-sniffer"].version,
    "4.0.0",
  );
  assert.equal(
    packageLock.packages["node_modules/isomorphic-dompurify/node_modules/html-encoding-sniffer"],
    undefined,
  );
  assert.equal(packageLock.packages["node_modules/@exodus/bytes"], undefined);
});

test("the server keeps the sanitizer and jsdom external so runtime files resolve beside the package", () => {
  const config = require(path.join(root, "next.config.js"));
  assert.ok(config.serverExternalPackages.includes("isomorphic-dompurify"));
  assert.ok(config.serverExternalPackages.includes("jsdom"));
});

test("the sanitizer loads through plain CommonJS require without require(ESM)", () => {
  // A transpiler or local Node's require(ESM) support can mask the production crash.
  const result = spawnSync(
    process.execPath,
    [
      "--no-experimental-require-module",
      "-e",
      `const assert = require("node:assert/strict");
       const DOMPurify = require("isomorphic-dompurify");
       assert.equal(
         DOMPurify.sanitize('<p>safe</p><script>alert(1)</script><img src="x" onerror="alert(1)">'),
         '<p>safe</p><img src="x">'
       );
       console.log("CommonJS sanitizer loaded and removed XSS");`,
    ],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  );

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CommonJS sanitizer loaded and removed XSS/);
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
