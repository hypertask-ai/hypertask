import { readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseline = JSON.parse(readFileSync(new URL("./ui-patterns-baseline.json", import.meta.url), "utf8"));

function name(node) {
  if (node?.type === "JSXIdentifier") return node.name;
  if (node?.type === "JSXMemberExpression") return `${name(node.object)}.${name(node.property)}`;
  return "";
}

function attribute(node, key, source) {
  const value = node.attributes.find((item) => item.type === "JSXAttribute" && item.name.name === key)?.value;
  if (value?.type === "Literal") return String(value.value);
  return value ? source.getText(value) : "";
}

function ratchet(id, message, matches, owners = []) {
  return {
    meta: { type: "problem", schema: [], messages: { reuse: message } },
    create(context) {
      const file = relative(root, context.filename).replaceAll("\\", "/");
      if (owners.includes(file)) return {};
      const nodes = [];
      const imports = new Map();
      const source = context.sourceCode;
      return {
        ImportDeclaration(node) {
          for (const item of node.specifiers) {
            imports.set(item.local.name, {
              source: node.source.value,
              imported: item.imported?.name ?? "default",
            });
          }
        },
        JSXOpeningElement(node) {
          if (matches(node, source, imports)) nodes.push(node);
        },
        "Program:exit"() {
          const allowed = baseline[id]?.[file] ?? 0;
          // Keep legacy screens working, but a new file has no legacy allowance.
          if (nodes.length > allowed) {
            for (const node of nodes.slice(allowed)) context.report({ node, messageId: "reuse" });
          }
        },
      };
    },
  };
}

const noNewChoiceMenus = ratchet(
  "no-new-choice-menus",
  'Use the Ctrl+K command system in src/components/Modals/commands/HTC/commands.tsx. Reuse OptionPickerModal from @/components/Modals/OptionPicker, TableColumnsPicker for columns, AssignModal for board scope, and BoardPriorityMode for board sort. Do not add a native select, dropdown or floating choice panel. Existing per-file debt cannot increase.',
  (node, source, imports) => {
    const tag = name(node.name);
    const binding = imports.get(tag.split(".")[0]);
    if (binding?.source === "lucide-react") return false;
    const imported = binding?.imported === "default" ? binding.source : binding?.imported;
    if (tag === "select" || /(?:Dropdown|Select|Listbox|Menu|Popover)(?:\.|$)/.test(tag) || /(?:dropdown|select|listbox|menu|popover)/i.test(imported ?? "")) return true;
    if (["menu", "listbox"].includes(attribute(node, "role", source))) return true;
    const classes = attribute(node, "className", source);
    const body = source.getText(node.parent);
    return /\b(?:absolute|fixed)\b/.test(classes) && /\btop-full\b/.test(classes) && /<(?:button|select|CheckRow|\w*MenuItem)\b/.test(body);
  },
);

export const uiPatternsPlugin = {
  meta: { name: "hypertask-ui-reuse", version: "1.0.0" },
  rules: { "no-new-choice-menus": noNewChoiceMenus },
};

export const uiPatternsLintConfig = {
  files: ["src/**/*.{js,jsx,ts,tsx}"],
  plugins: { "hypertask-ui": uiPatternsPlugin },
  rules: { "hypertask-ui/no-new-choice-menus": "error" },
};
