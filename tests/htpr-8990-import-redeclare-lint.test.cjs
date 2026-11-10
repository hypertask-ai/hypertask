const assert = require("node:assert/strict");
const test = require("node:test");
const { ESLint } = require("eslint");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "..");

async function lintText(code, filePath) {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: true });
  return result;
}

test("duplicate imports fail lint outside the baseline", async () => {
  const filePath = join(root, "tests/fixtures/htpr-8990-duplicate-import.ts");
  const result = await lintText(
    'import { join } from "node:path";\nimport { join } from "node:path";\nexport const value = join("a", "b");\n',
    filePath,
  );
  assert.ok(result.messages.some((message) => message.ruleId === "import/no-duplicates"), result.messages);
});

test("TypeScript overload declarations stay allowed", async () => {
  const filePath = join(root, "tests/fixtures/htpr-8990-overload.ts");
  const result = await lintText(
    "export function pick(id: string): string;\nexport function pick(id: number): number;\nexport function pick(id: string | number) { return String(id); }\n",
    filePath,
  );
  const redeclare = result.messages.filter((message) => message.ruleId?.includes("redeclare"));
  assert.deepEqual(redeclare, []);
});

test("a repeated variable name in one scope fails lint outside the baseline", async () => {
  const filePath = join(root, "tests/fixtures/htpr-8990-redeclare.ts");
  const result = await lintText("const lane = 1;\nconst lane = 2;\nexport { lane };\n", filePath);
  assert.ok(
    result.messages.some((message) => message.ruleId === "@typescript-eslint/no-redeclare"),
    result.messages,
  );
});
