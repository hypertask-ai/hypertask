const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const nextConfig = require(path.join(__dirname, "..", "next.config.js"));

test("the server keeps jsdom runtime assets beside the external sanitizer", () => {
  for (const packageName of ["isomorphic-dompurify", "jsdom"]) {
    assert.ok(
      nextConfig.serverExternalPackages?.includes(packageName),
      `${packageName} must stay external so jsdom resolves its stylesheet in node_modules`,
    );
  }
});

test("server sanitizing works without Node's optional require(esm) support", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--no-experimental-require-module",
      "-e",
      `
        const assert = require("node:assert/strict");
        require("next/dist/server/require-hook");
        // Load natively before jiti can transform any ESM dependencies.
        require("isomorphic-dompurify");
        const { sanitizeAiHtml } = require("jiti")(${JSON.stringify(__filename)}, {
          interopDefault: true,
        })(${JSON.stringify(path.join(__dirname, "..", "src/utils/helperFunctions/sanitizeHtml.ts"))});
        assert.equal(
          sanitizeAiHtml('<p onclick="alert(1)">safe<script>alert(2)</script><img src="x" onerror="alert(3)"><a href="javascript:alert(4)">link</a></p>'),
          '<p>safe<img src="x"><a>link</a></p>',
        );
        const mention = '<span data-type="mention" data-id="42" projectid="15" uniqueindex="6847">task</span>';
        assert.equal(sanitizeAiHtml(mention), mention);
        assert.equal(sanitizeAiHtml(""), "");
        const { createRequire } = require("node:module");
        const { JSDOM } = createRequire(require.resolve("isomorphic-dompurify"))("jsdom");
        const dom = new JSDOM("<p>safe</p>");
        assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector("p")).display, "block");
        dom.window.close();
        console.log("SERVER_SANITIZER_OK");
      `,
    ],
    {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /SERVER_SANITIZER_OK/);
});
