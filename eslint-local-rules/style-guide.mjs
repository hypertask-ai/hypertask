import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "eslint-plugin-tailwindcss";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const themeDirectory = join(rootDirectory, "src/styles/tailwindThemes");
const colorTokenFiles = [
  join(rootDirectory, "tailwind.config.ts"),
  ...readdirSync(themeDirectory).map((file) => join(themeDirectory, file)),
];

const rawTailwindColor = /(?:^|:)!?(?:text|bg|border(?:-[trblxyse])?|divide|outline|ring(?:-offset)?|fill|stroke|from|via|to|decoration|placeholder|accent|caret|shadow|inset-shadow|inset-ring|drop-shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?:\/[\w.\[\]-]+)?!?$/;
const sectionFocusFiles = new Set([
  "src/components/PageComponents/Interactive-Onboarding/Components/Landing/Section.tsx",
  "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
  "src/components/PageComponents/Shared/Project/section.tsx",
]);

function normalizeColorLiteral(literal) {
  const compact = literal.toLowerCase().replace(/\s+/g, "");
  const hex = compact.match(/^#([0-9a-f]{3,4})$/);
  if (!hex) return compact;
  return `#${[...hex[1]].map((digit) => digit.repeat(2)).join("")}`;
}

function extractColorLiterals(value) {
  const literals = [...value.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0]);
  const functionStart = /\b(?:rgb|rgba|hsl|hsla)\(/gi;
  let match;

  while ((match = functionStart.exec(value))) {
    let depth = 1;
    let cursor = functionStart.lastIndex;
    while (cursor < value.length && depth > 0) {
      if (value[cursor] === "(") depth += 1;
      if (value[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    if (depth === 0) literals.push(value.slice(match.index, cursor));
    functionStart.lastIndex = cursor;
  }

  return literals;
}

const approvedColorLiterals = new Set(
  colorTokenFiles.flatMap((file) =>
    extractColorLiterals(readFileSync(file, "utf8")).map(normalizeColorLiteral),
  ),
);

function staticStrings(node, values = [], visited = new WeakSet()) {
  if (!node || typeof node !== "object" || visited.has(node)) return values;
  visited.add(node);

  if (node.type === "Literal" && typeof node.value === "string") {
    values.push(node.value);
    return values;
  }
  if (node.type === "TemplateElement") {
    values.push(node.value.raw);
    return values;
  }

  for (const [key, child] of Object.entries(node)) {
    if (["parent", "loc", "range", "tokens", "comments"].includes(key)) continue;
    if (Array.isArray(child)) {
      child.forEach((item) => staticStrings(item, values, visited));
    } else {
      staticStrings(child, values, visited);
    }
  }
  return values;
}

function attributeName(node) {
  return node.name?.type === "JSXIdentifier" ? node.name.name : undefined;
}

function attributeStrings(node, names) {
  return names.has(attributeName(node)) ? staticStrings(node.value) : [];
}

function classTokens(node) {
  return attributeStrings(node, new Set(["className"]))
    .flatMap((value) => value.split(/\s+/))
    .filter(Boolean);
}

const noRawTailwindColors = {
  meta: {
    type: "problem",
    docs: { description: "Disallow raw Tailwind color scales in className props" },
    schema: [],
    messages: {
      rawColor: "Use a Hypertask theme token instead of raw Tailwind color '{{className}}'.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        for (const token of classTokens(node)) {
          if (rawTailwindColor.test(token)) {
            context.report({ node, messageId: "rawColor", data: { className: token } });
          }
        }
      },
    };
  },
};

const noUnapprovedColorLiterals = {
  meta: {
    type: "problem",
    docs: { description: "Allow color literals only when they are declared as design tokens" },
    schema: [],
    messages: {
      unapprovedColor: "Move color '{{color}}' into a Hypertask theme token before using it here.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        const values = attributeStrings(node, new Set(["className", "style"]));
        for (const value of values) {
          for (const color of extractColorLiterals(value)) {
            if (!approvedColorLiterals.has(normalizeColorLiteral(color))) {
              context.report({ node, messageId: "unapprovedColor", data: { color } });
            }
          }
        }
      },
    };
  },
};

function forbiddenUtility(token, filename) {
  const importantFree = token.replace(/(^|:)!/, "$1").replace(/!$/, "");
  const base = importantFree.split(":").at(-1);

  if (/^border-white(?:\/.*)?$/.test(base)) return "white border";
  if (base === "border-white-black") {
    const focusVariant = importantFree
      .split(":")
      .slice(0, -1)
      .some((variant) => ["focus", "focus-visible", "focus-within"].includes(variant));
    if (focusVariant && sectionFocusFiles.has(filename)) return undefined;
    return "white focus border";
  }
  if (/^bg-(?:gradient-|linear-|radial(?:-|$)|conic(?:-|$))/.test(base)) return "gradient";
  if (/^rounded(?:-(?:[trblse]|ss|se|ee|es|tl|tr|br|bl))?-(?:lg|xl|[2-9]xl)$/.test(base)) {
    return "oversized radius";
  }
  if (base === "shadow-lg") return "oversized shadow";
  return undefined;
}

const noForbiddenUtilities = {
  meta: {
    type: "problem",
    docs: { description: "Disallow Tailwind utilities forbidden by the Hypertask style guide" },
    schema: [],
    messages: {
      forbiddenUtility: "Remove forbidden {{kind}} utility '{{className}}' and use the style-guide pattern.",
    },
  },
  create(context) {
    const filename = (context.filename || context.getFilename())
      .replaceAll("\\", "/")
      .replace(`${rootDirectory.replaceAll("\\", "/")}/`, "");
    return {
      JSXAttribute(node) {
        for (const token of classTokens(node)) {
          const kind = forbiddenUtility(token, filename);
          if (kind) {
            context.report({
              node,
              messageId: "forbiddenUtility",
              data: { kind, className: token },
            });
          }
        }
      },
    };
  },
};

export const styleGuidePlugin = {
  meta: { name: "hypertask-style-guide", version: "1.0.0" },
  rules: {
    "no-raw-tailwind-colors": noRawTailwindColors,
    "no-unapproved-color-literals": noUnapprovedColorLiterals,
    "no-forbidden-utilities": noForbiddenUtilities,
  },
};

const plugins = {
  "hypertask-style": styleGuidePlugin,
  tailwindcss,
};
const settings = {
  tailwindcss: {
    cssConfigPath: join(rootDirectory, "src/styles/tailwind-entry.css"),
  },
};
const enabledRules = {
  "tailwindcss/no-custom-classname": "error",
  "hypertask-style/no-raw-tailwind-colors": "error",
  "hypertask-style/no-unapproved-color-literals": "error",
  "hypertask-style/no-forbidden-utilities": "error",
};

export const styleGuideLintConfig = {
  files: ["src/**/*.tsx"],
  languageOptions: {
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  },
  plugins,
  settings,
  rules: enabledRules,
};

export const styleGuideRuleRegistrationConfig = {
  files: styleGuideLintConfig.files,
  plugins,
  settings,
  rules: Object.fromEntries(Object.keys(enabledRules).map((rule) => [rule, "off"])),
};
