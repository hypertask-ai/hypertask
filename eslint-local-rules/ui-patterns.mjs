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
    if (["lucide-react", "@/components/Common/selection-checkbox"].includes(binding?.source)) return false;
    const imported = binding?.imported === "default" ? binding.source : binding?.imported;
    if (tag === "select" || [tag, imported ?? ""].some((value) => /(?:Dropdown|Select|Listbox|Menu|Popover)(?:\.|$)/.test(value)) || /(?:^|[\/.-])(?:react-)?(?:dropdown|select|listbox|menu|popover)(?:$|[\/.-])/i.test(binding?.source ?? "")) return true;
    if (["menu", "listbox"].includes(attribute(node, "role", source))) return true;
    const classes = attribute(node, "className", source);
    const body = source.getText(node.parent);
    return /\b(?:absolute|fixed)\b/.test(classes) && /\btop-full\b/.test(classes) && /<(?:button|select|CheckRow|\w*MenuItem)\b/.test(body);
  },
);

const noNewViewSaveActions = ratchet(
  "no-new-view-save-actions",
  'Reuse SaveView from @/components/PageComponents/Kanban/HeaderComponents/SaveViewHeaderKanban and SaveViewModal from @/components/Modals/ViewModals/SaveViewModal. Do not add a parallel Save, Reset or Save as view action. Existing per-file debt cannot increase.',
  (node, source) => {
    if (!["button", "span", "a", "Button"].includes(name(node.name))) return false;
    if (!attribute(node, "onClick", source) && name(node.name) !== "button" && name(node.name) !== "Button") return false;
    const body = source.getText(node.parent);
    if (/\bsave\s+(?:as\s+(?:new\s+)?)?view\b/i.test(body)) return true;
    return /view/i.test(source.text) && (
      />\s*(?:Save|Reset(?: changes| view)?)\s*</i.test(body) ||
      /\b(?:onSave|onReset|saveAs)\b/.test(attribute(node, "onClick", source))
    );
  },
  [
    "src/components/PageComponents/Kanban/HeaderComponents/SaveViewHeaderKanban.tsx",
    "src/components/Modals/ViewModals/SaveViewModal.tsx",
  ],
);

const noNewSelectionStyles = ratchet(
  "no-new-selection-styles",
  'Use OptionPickerModal options with checked for choices, TableColumnsPicker for columns, or AssignModal for scope. For bulk row selection reuse SelectionCheckbox from @/components/Common/selection-checkbox. Do not add a native checkbox/radio, custom CheckRow, check icon or checkmark glyph. Existing per-file debt cannot increase.',
  (node, source, imports) => {
    const tag = name(node.name);
    const binding = imports.get(tag.split(".")[0]);
    if (binding?.source === "@/components/Common/selection-checkbox") return false;
    if (["checkbox", "radio"].includes(attribute(node, "type", source)) || ["checkbox", "radio"].includes(attribute(node, "role", source))) return true;
    const imported = binding?.imported === "default" ? binding.source : binding?.imported;
    if (/(?:Checkbox|CheckBox|CheckRow|Checkmark|CheckMark|CheckSquare)/i.test(`${tag} ${imported ?? ""}`)) return true;
    if (binding?.source === "lucide-react" && ["Check", "CheckIcon", "CheckSquare", "SquareCheck"].includes(binding.imported)) return true;
    return (node.parent.children ?? []).some((child) =>
      (child.type === "JSXText" && /[✓✔☑]/.test(child.value)) ||
      (child.type === "JSXExpressionContainer" && child.expression.type === "Literal" && /[✓✔☑]/.test(String(child.expression.value)))
    );
  },
  [
    "src/components/Modals/OptionPicker/index.tsx",
    "src/components/PageComponents/Kanban/TableView/TableColumnsPicker.tsx",
    "src/components/Modals/AssignToUser/AssignToUser.tsx",
    "src/components/Common/selection-checkbox.tsx",
  ],
);

export const uiPatternsPlugin = {
  meta: { name: "hypertask-ui-reuse", version: "1.0.0" },
  rules: {
    "no-new-choice-menus": noNewChoiceMenus,
    "no-new-view-save-actions": noNewViewSaveActions,
    "no-new-selection-styles": noNewSelectionStyles,
  },
};

export const uiPatternsLintConfig = {
  files: ["src/**/*.{js,jsx,ts,tsx}"],
  plugins: { "hypertask-ui": uiPatternsPlugin },
  rules: Object.fromEntries(Object.keys(uiPatternsPlugin.rules).map((rule) => [`hypertask-ui/${rule}`, "error"])),
};
