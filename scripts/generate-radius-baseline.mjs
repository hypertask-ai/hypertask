import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import parser from "@typescript-eslint/parser";
import { styleGuidePlugin } from "../eslint-local-rules/style-guide.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [{
    files: ["src/**/*.tsx"],
    languageOptions: { parser },
    plugins: { "hypertask-style": styleGuidePlugin },
    rules: { "hypertask-style/no-forbidden-utilities": ["error", { ignoreRadiusBaseline: true }] },
  }],
});
const baseline = {};
const suppressionsUrl = new URL("../eslint-local-rules/style-guide-suppressions.json", import.meta.url);
const suppressions = JSON.parse(readFileSync(suppressionsUrl, "utf8"));
const ruleId = "hypertask-style/no-forbidden-utilities";
for (const result of (await eslint.lintFiles(["src/**/*.tsx"])).sort((a, b) => a.filePath.localeCompare(b.filePath))) {
  const fatal = result.messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${result.filePath}: ${fatal.message}`);
  const count = result.messages.filter((message) => message.messageId === "forbiddenRadius").length;
  const filename = relative(root, result.filePath).split("\\").join("/");
  if (count) baseline[filename] = count;
  const legacy = suppressions[filename]?.[ruleId];
  if (legacy) {
    legacy.count = Math.min(legacy.count, result.messages.filter((message) => message.messageId === "forbiddenUtility").length);
    if (!legacy.count) delete suppressions[filename][ruleId];
    if (!Object.keys(suppressions[filename]).length) delete suppressions[filename];
  }
}
writeFileSync(suppressionsUrl, `${JSON.stringify(suppressions, null, 2)}\n`);
writeFileSync(new URL("../eslint-local-rules/radius-baseline.json", import.meta.url), `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`${Object.values(baseline).reduce((sum, count) => sum + count, 0)} radius violations in ${Object.keys(baseline).length} files`);
