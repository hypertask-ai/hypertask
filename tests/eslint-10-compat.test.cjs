// HTPR-6517: ESLint 10 crashes unless Next's Babel parser and ESLint 9-era
// plugins are replaced. This test lints one JS file and one TS file through
// the real config so a future dep bump cannot hide the same TypeError.
const assert = require("node:assert/strict");
const test = require("node:test");
const { ESLint } = require("eslint");

async function lintText(code, filePath) {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(code, { filePath });
  return result;
}

test("lints a JS file without the ESLint 10 parser crash", async () => {
  const result = await lintText("const a = 1;\n", "next.config.js");
  assert.equal(result.fatalErrorCount, 0, result.messages[0]?.message);
});

test("lints a TypeScript file without the plugin-react getFilename crash", async () => {
  const result = await lintText(
    "export const ping = 1;\n",
    "src/lib/eslint-10-compat-fixture.ts",
  );
  assert.equal(result.fatalErrorCount, 0, result.messages[0]?.message);
});
