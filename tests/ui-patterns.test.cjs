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

// HTPR-6422, ee15925f7 (#547): parallel dirty-state Save and Save as view.
// HTPR-6572, 6e166acdd (#706): another mobile Save view implementation.
test("rejects historical parallel view-save actions", async () => {
  for (const code of [
    'const MyTasksViewTabs = () => <button onClick={onSave}>Save</button>;',
    '<button onClick={saveAs}><span>Save as view</span></button>;',
    '<button onClick={() => { onSave(); setActionsOpen(false); }}>Save view</button>;',
    'const ViewTabs = () => <button onClick={onReset}>Reset changes</button>;',
  ]) {
    const messages = await lint(code, undefined, "no-new-view-save-actions");
    assert.equal(messages.length, 1, code);
    assert.match(messages[0].message, /SaveViewHeaderKanban.*SaveViewModal/);
  }
});

test("allows shared view save controls and ordinary non-view form saves", async () => {
  assert.deepEqual(await lint(`
    import { SaveView } from "@/components/PageComponents/Kanban/HeaderComponents/SaveViewHeaderKanban";
    import SaveViewModal from "@/components/Modals/ViewModals/SaveViewModal";
    <><SaveView dirty={dirty} onSaveClick={save} /><SaveViewModal /></>;
  `), []);
  assert.deepEqual(await lint('<button onClick={submit}>Save profile</button>;'), []);
  const filename = "src/app/my-tasks/MyTasksViewTabs.tsx";
  const current = readFileSync(resolve(root, filename), "utf8");
  assert.deepEqual(await lint(current, filename, "no-new-view-save-actions"), []);
  assert.equal((await lint(`${current}\nconst extra = <button>Save as view</button>;`, filename, "no-new-view-save-actions")).length, 1);
});

// HTPR-6422, ee15925f7 (#547): native CheckRow implementation.
// HTPR-6461, 95f3471b5 (#578): new Show snoozed uses of that custom CheckRow.
test("rejects historical native checkbox and repeated custom CheckRow usage", async () => {
  for (const code of [
    '<input type="checkbox" checked={checked} onChange={onChange} className="size-3.5 accent-shadcn-primary" />;',
    '<CheckRow checked={config.filters.showSnoozed === true} label="Show snoozed" onChange={onChange} />;',
    '<button role="checkbox" aria-checked={checked} />;',
    '<input type="radio" />;',
    'import { Check as Tick } from "lucide-react"; <Tick />;',
    '<span>✓</span>;',
    '<span>{"✔"}</span>;',
  ]) {
    const messages = await lint(code, undefined, "no-new-selection-styles");
    assert.equal(messages.length, 1, code);
    assert.match(messages[0].message, /OptionPickerModal.*SelectionCheckbox/);
  }
});

test("selection reuse is allowed but new custom styles in a legacy file fail", async () => {
  assert.deepEqual(await lint('import SelectionCheckbox from "@/components/Common/selection-checkbox"; <SelectionCheckbox isChecked={selected} onClick={toggle} />;'), []);
  const filename = "src/app/my-tasks/MyTasksViewControls.tsx";
  const current = readFileSync(resolve(root, filename), "utf8");
  assert.deepEqual(await lint(current, filename), []);
  assert.equal((await lint(`${current}\nconst extra = <input type="checkbox" />;`, filename, "no-new-selection-styles")).length, 1);
});

test("only the exact shared implementations own raw save and selection rendering", async () => {
  assert.deepEqual(await lint('<button>Save as view</button>;', "src/components/PageComponents/Kanban/HeaderComponents/SaveViewHeaderKanban.tsx", "no-new-view-save-actions"), []);
  assert.deepEqual(await lint('<input type="checkbox" />;', "src/components/Modals/OptionPicker/index.tsx", "no-new-selection-styles"), []);
  assert.equal((await lint('<input type="checkbox" />;', "src/components/Modals/OptionPicker/Copy.tsx", "no-new-selection-styles")).length, 1);
});

test("cached lint rechecks unchanged UI after baseline or matcher edits", () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
  const { execFileSync } = require("node:child_process");
  mkdirSync(resolve(root, ".cache"), { recursive: true });
  const fixture = mkdtempSync(resolve(root, ".cache/ui-patterns-"));
  try {
    mkdirSync(resolve(fixture, "eslint-local-rules"));
    mkdirSync(resolve(fixture, "src"));
    const modulePath = resolve(fixture, "eslint-local-rules/ui-patterns.mjs");
    const baselinePath = resolve(fixture, "eslint-local-rules/ui-patterns-baseline.json");
    const moduleCode = readFileSync(resolve(root, "eslint-local-rules/ui-patterns.mjs"), "utf8");
    writeFileSync(modulePath, moduleCode);
    writeFileSync(baselinePath, JSON.stringify({ "no-new-choice-menus": { "src/Test.tsx": 1 } }));
    writeFileSync(resolve(fixture, "src/Test.tsx"), '<select />;');
    const run = () => Number(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { createRequire } from "node:module";
      const require = createRequire(${JSON.stringify(resolve(root, "package.json"))});
      const { ESLint } = require("eslint");
      const parser = require("@typescript-eslint/parser");
      const { uiPatternsLintConfig } = await import(${JSON.stringify(modulePath)});
      const eslint = new ESLint({ cwd: ${JSON.stringify(fixture)}, overrideConfigFile: true,
        overrideConfig: { ...uiPatternsLintConfig, languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
        cache: true, cacheStrategy: "content", cacheLocation: ${JSON.stringify(resolve(fixture, ".eslintcache"))} });
      const results = await eslint.lintFiles(["src/Test.tsx"]);
      console.log(results.reduce((sum, result) => sum + result.errorCount, 0));
    `], { encoding: "utf8" }).trim());
    assert.equal(run(), 0);
    writeFileSync(baselinePath, '{}');
    assert.equal(run(), 1, "baseline edits must invalidate a prior green result");
    writeFileSync(resolve(fixture, "src/Test.tsx"), '<input />;');
    assert.equal(run(), 0);
    writeFileSync(modulePath, moduleCode.replace('tag === "select"', '(tag === "select" || tag === "input")'));
    assert.equal(run(), 1, "matcher edits must invalidate a prior green result");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
