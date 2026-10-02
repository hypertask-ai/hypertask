const assert = require("node:assert/strict");
const path = require("node:path");
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
