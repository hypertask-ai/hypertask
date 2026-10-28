import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baselineText = readFileSync(new URL("./design-tokens-baseline.json", import.meta.url), "utf8");
const baseline = JSON.parse(baselineText);
const missingBaselineFiles = Object.values(baseline).flatMap((files) => Object.keys(files)).filter((file) => !existsSync(join(root, file)));
const tokenValue = /^(?:[a-z-]+:)?(?:var\(--[\w-]+\)|--[\w-]+)$/;
const utilities = {
  shadows: /(?:^|:)!?(?:shadow|drop-shadow|inset-shadow)-\[([^\]]+)\]/g,
  layers: /(?:^|:)!?-?z-\[([^\]]+)\]/g,
  corners: /(?:^|:)!?rounded(?:-[trblse]{1,2})?-\[([^\]]+)\]/g,
  "text-sizes": /(?:^|:)!?text-\[(\d+(?:\.\d+)?px)\]/g,
  colours: /(?:^|:)!?(?:bg|text|border(?:-[trblxyse])?|divide|outline|ring(?:-offset)?|fill|stroke|from|via|to|decoration|placeholder|accent|caret|shadow)-\[([^\]]+)\]/g,
  "theme-selectors": /\[(\.(?:amoled|porcelain|graphite|dia)(?![a-z\d-])[^\]]*&)\]/gi,
};
const colorProperty = /(?:color|background|border|fill|stroke|shadow)/i;
const colorLiteral = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color)\(/i;
const tokenColorFunction = /\b(?:rgba?|hsla?|oklch|oklab)\(\s*var\(--[\w-]+\)\s*\)/gi;

function tokenStyleValue(node) {
  if (node.type === "ConditionalExpression") return tokenStyleValue(node.consequent) && tokenStyleValue(node.alternate);
  if (node.type === "Identifier") return node.name === "undefined";
  if (node.type === "Literal") {
    return node.value === null || (typeof node.value === "string" &&
      (tokenValue.test(node.value) || /^(?:none|inherit|initial|unset|auto|normal)$/.test(node.value)));
  }
  return node.type === "TemplateLiteral" && node.expressions.length === 0 && tokenValue.test(node.quasis[0].value.cooked ?? "");
}

export const designTokenVersion = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .update(baselineText)
  .update(JSON.stringify(missingBaselineFiles))
  .digest("hex");

export function designTokenRules(allowances = baseline) {
  return Object.fromEntries(Object.entries(utilities).map(([family, utility]) => {
    const missing = Object.keys(allowances[family] ?? {}).filter((file) => !existsSync(join(root, file)));
    return [
    `no-raw-design-${family}`,
    {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          raw: `Use a shared theme token for ${family}, not '{{value}}'. Existing per-file debt cannot increase.`,
          missing: "Deleted files retain design-token debt: {{files}}. Run node scripts/design-token-baseline.mjs --prune and commit the smaller baseline.",
          stale: "Design-token debt decreased. Run node scripts/design-token-baseline.mjs --prune and commit the smaller baseline.",
        },
      },
      create(context) {
        const file = relative(root, context.filename).replaceAll("\\", "/");
        if (file.startsWith("src/styles/tailwindThemes/")) return {};
        const matches = [];
        function inspect(node, value) {
          for (const token of value.split(/\s+/)) {
            utility.lastIndex = 0;
            for (const match of token.matchAll(utility)) {
              if (family === "colours" && !colorLiteral.test(match[1].replace(tokenColorFunction, ""))) continue;
              if (!tokenValue.test(match[1])) matches.push({ node, value: match[0] });
            }
          }
        }
        return {
          Literal(node) {
            if (typeof node.value === "string") inspect(node, node.value);
          },
          TemplateElement(node) {
            inspect(node, node.value.cooked ?? node.value.raw);
          },
          Property(node) {
            if (node.parent.type !== "ObjectExpression") return;
            const key = node.key.name ?? node.key.value;
            const value = context.sourceCode.getText(node.value);
            let styleFamily = { boxShadow: "shadows", zIndex: "layers", fontSize: "text-sizes" }[key];
            if (/^border(?:TopLeft|TopRight|BottomLeft|BottomRight|StartStart|StartEnd|EndStart|EndEnd)?Radius$/.test(key ?? "")) styleFamily = "corners";
            if (family === styleFamily && !tokenStyleValue(node.value)) {
              matches.push({ node, value: String(key) });
            }
            if (family === "colours" && colorProperty.test(key ?? "") && colorLiteral.test(value.replace(tokenColorFunction, ""))) {
              matches.push({ node, value: String(key) });
            }
          },
          "Program:exit"(node) {
            const deleted = missing.filter((path) => path !== file);
            if (deleted.length) context.report({ node, messageId: "missing", data: { files: deleted.join(", ") } });
            const allowed = allowances[family]?.[file] ?? 0;
            for (const match of matches.slice(allowed)) {
              context.report({ node: match.node, messageId: "raw", data: { value: match.value } });
            }
            if (matches.length < allowed) context.report({ node, messageId: "stale" });
          },
        };
      },
    },
    ];
  }));
}
