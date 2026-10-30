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
