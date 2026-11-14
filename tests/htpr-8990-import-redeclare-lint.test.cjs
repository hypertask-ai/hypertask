const assert = require("node:assert/strict");
const test = require("node:test");
const { join, resolve } = require("node:path");
const { ESLint } = require("eslint");

const root = resolve(__dirname, "..");

async function lintText(code, filePath) {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath: join(root, filePath), warnIgnored: true });
  return result;
}

const duplicateImports = 'import { join } from "node:path";\nimport { join } from "node:path";\nexport const value = join("a", "b");\n';

test("a new duplicate import fails lint in TypeScript files", async () => {
  const result = await lintText(duplicateImports, "src/lib/htpr8990-probe-duplicate-import.ts");
  assert.ok(result.messages.some((message) => message.ruleId === "import/no-duplicates"), result.messages);
});

test("a new duplicate import fails lint in ES module scripts", async () => {
  const result = await lintText(
    'import { join } from "node:path";\nimport { resolve as resolvePath } from "node:path";\nexport const value = join(resolvePath("a"));\n',
    "scripts/htpr8990-probe-duplicate-import.mjs",
  );
  assert.ok(result.messages.some((message) => message.ruleId === "import/no-duplicates"), result.messages);
});

test("a new repeated name fails lint in JavaScript files", async () => {
  const result = await lintText(
    "const lane = 1;\nconst lane = 2;\nmodule.exports = { lane };\n",
    "scripts/htpr8990-probe-redeclare.cjs",
  );
  assert.ok(result.messages.some((message) => message.ruleId === "no-redeclare"), result.messages);
});

test("a new repeated name fails lint in TypeScript files", async () => {
  const result = await lintText(
    "const lane = 1;\nconst lane = 2;\nexport { lane };\n",
    "src/lib/htpr8990-probe-redeclare.ts",
  );
  assert.ok(result.messages.some((message) => message.ruleId === "@typescript-eslint/no-redeclare"), result.messages);
});

test("TypeScript overload declarations stay allowed", async () => {
  const result = await lintText(
    "export function pick(id: string): string;\nexport function pick(id: number): number;\nexport function pick(id: string | number) { return String(id); }\n",
    "src/lib/htpr8990-probe-overload.ts",
  );
  const redeclare = result.messages.filter((message) => message.ruleId?.includes("redeclare"));
  assert.deepEqual(redeclare, []);
});
