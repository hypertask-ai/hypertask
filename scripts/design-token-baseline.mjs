import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { relative } from "node:path";
import { ESLint } from "eslint";
import parser from "@typescript-eslint/parser";
import { designTokenRules } from "../eslint-local-rules/design-tokens.mjs";

export function pruneBaseline(baseline, counts) {
  for (const [family, files] of Object.entries(counts)) {
    for (const [file, count] of Object.entries(files)) {
      if (count > (baseline[family]?.[file] ?? 0)) {
        throw new Error(`${file}: ${family} increased; replace raw styles with theme tokens.`);
      }
    }
  }
  return counts;
}

export async function countDesignTokens(cwd = process.cwd()) {
  const rules = designTokenRules({});
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    allowInlineConfig: false,
    overrideConfig: [{
      files: ["src/**/*.{js,jsx,ts,tsx,mjs,cjs}"],
      languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { local: { rules } },
      rules: Object.fromEntries(Object.keys(rules).map((rule) => [`local/${rule}`, "error"])),
    }],
  });
  const results = await eslint.lintFiles(["src/**/*.{js,jsx,ts,tsx,mjs,cjs}"]);
  const counts = Object.fromEntries(Object.keys(rules).map((rule) => [rule.replace("no-raw-design-", ""), {}]));
  for (const result of results.sort((a, b) => a.filePath.localeCompare(b.filePath))) {
    const file = relative(cwd, result.filePath).replaceAll("\\", "/");
    for (const message of result.messages) {
      if (!message.ruleId?.startsWith("local/no-raw-design-")) throw new Error(`${file}: ${message.message}`);
      const family = message.ruleId.replace("local/no-raw-design-", "");
      counts[family][file] = (counts[family][file] ?? 0) + 1;
    }
  }
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--prune") {
    throw new Error("Usage: node scripts/design-token-baseline.mjs --prune (never increases debt)");
  }
  const path = new URL("../eslint-local-rules/design-tokens-baseline.json", import.meta.url);
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  const counts = pruneBaseline(baseline, await countDesignTokens());
  writeFileSync(path, `${JSON.stringify(counts, null, 2)}\n`);
  console.log("Design-token baseline pruned; no allowances increased.");
}
