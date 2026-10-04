const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { Linter } = require("eslint");
const parser = require("@typescript-eslint/parser");
const root = resolve(__dirname, "..");
const pluginPromise = import("../eslint-local-rules/ui-patterns.mjs");

async function lint(code, filename = "src/components/NewUiPattern.tsx", rule) {
  const { uiPatternsLintConfig } = await pluginPromise;
  const config = {
    ...uiPatternsLintConfig,
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    ...(rule ? { rules: { [`hypertask-ui/${rule}`]: "error" } } : {}),
  };
  const messages = new Linter({ cwd: root }).verify(code, [config], {
    filename: resolve(root, filename), allowInlineConfig: false,
  });
  assert.ok(messages.every((message) => message.ruleId?.startsWith("hypertask-ui/")), JSON.stringify(messages));
  return messages;
}

// HTPR-6422, ee15925f7 (#547), MyTasksViewControls.tsx: sort field select.
test("rejects the historical native sort picker", async () => {
  const messages = await lint('<select value={config.sort.field} onChange={onChange}><option value="due">Due date</option></select>;');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /Ctrl\+K.*OptionPickerModal/);
});

// HTPR-6457, 09391ff27 (#571), MyTasksViewControls.tsx: Involvement panel.
test("rejects the historical hand-built involvement dropdown", async () => {
  const messages = await lint('<div className="absolute right-0 top-full z-40 mt-1 w-56 bg-modalBackground"><Field label="Involvement"><CheckRow checked={selected} /></Field></div>;', undefined, "no-new-choice-menus");
  assert.equal(messages.length, 1);
});

test("rejects aliased library dropdowns, member menus and explicit menu roles", async () => {
  for (const code of [
    'import { Dropdown as Choices } from "reactstrap"; <Choices />;',
    'import Choices from "react-select"; <Choices />;',
    'import { Menu as Choices } from "@headlessui/react"; <Choices.Items />;',
    '<div role="listbox" />;',
    '<Dropdown.Menu />;',
  ]) assert.ok((await lint(code)).length > 0, code);
});

test("allows the existing Ctrl+K pickers and unrelated icons", async () => {
  const messages = await lint(`
    import OptionPickerModal from "@/components/Modals/OptionPicker";
    import AssignModal from "@/components/Modals/AssignToUser/AssignToUser";
    import TableColumnsPicker from "@/components/PageComponents/Kanban/TableView/TableColumnsPicker";
    import BoardPriorityMode from "@/components/Modals/Kanban/BoardPriorityMode";
    import { Menu } from "lucide-react";
    <><OptionPickerModal /><AssignModal /><TableColumnsPicker /><BoardPriorityMode /><Menu /><input type="text" /></>;
  `);
  assert.deepEqual(messages, []);
});

test("production debt stays valid, removal passes, and additional debt in the same file fails", async () => {
  const filename = "src/app/my-tasks/MyTasksViewControls.tsx";
  const current = readFileSync(resolve(root, filename), "utf8");
  assert.deepEqual(await lint(current, filename, "no-new-choice-menus"), []);
  assert.deepEqual(await lint('export default () => <div />;', filename, "no-new-choice-menus"), []);
  const increased = await lint(`${current}\nconst newPicker = <select />;`, filename, "no-new-choice-menus");
  assert.equal(increased.length, 1);
});

test("the actual required CI lint entry point enables the UI checks", async () => {
  const { ESLint } = require("eslint");
  const config = await new ESLint({ cwd: root }).calculateConfigForFile("src/app/my-tasks/MyTasksViewControls.tsx");
  const { uiPatternsPlugin } = await pluginPromise;
  for (const rule of Object.keys(uiPatternsPlugin.rules)) assert.equal(config.rules[`hypertask-ui/${rule}`][0], 2);
  const workflow = readFileSync(resolve(root, ".github/workflows/ci-tests.yml"), "utf8");
  assert.match(workflow, /name: ci-tests/);
  assert.match(workflow, /name: Lint[\s\S]*?run: npm run lint/);
});
