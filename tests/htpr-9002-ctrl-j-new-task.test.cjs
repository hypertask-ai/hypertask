const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const {
  FALLBACK_NEW_TASK_WRITE_CHIPS,
  buildNewTaskWriteChips,
  buildNewTaskWritePrompt,
  isNewTaskCtrlJ,
  plainTextFromHtml,
  shapeNewTaskWriteResult,
} = jiti(path.join(root, "src/lib/ai/newTaskWrite.ts"));

const template = {
  id: 7,
  name: "Bug report",
  title: "Bug: ",
  descriptionHtml: "<p>Steps</p><ul><li>One</li></ul>",
  priorityIndex: 1,
  estimateIndex: 2,
  labelIds: [5],
};

test("flag is an OWNER_AND_QA feature flag", () => {
  const source = read("src/lib/flags/definitions/htpr-9002-ctrl-j-new-task.ts");
  assert.match(source, /"htpr-9002-ctrl-j-new-task"/);
  assert.match(source, /defaultMode: "OWNER_AND_QA"/);
  assert.match(source, /kind: "feature"/);
});

test("Ctrl+J matches only plain Ctrl or Cmd with J", () => {
  const base = { code: "KeyJ", altKey: false, shiftKey: false, metaKey: false, ctrlKey: false };
  assert.equal(isNewTaskCtrlJ({ ...base, ctrlKey: true }, false), true);
  assert.equal(isNewTaskCtrlJ({ ...base, metaKey: true }, true), true);
  assert.equal(isNewTaskCtrlJ({ ...base, metaKey: true }, false), false);
  assert.equal(isNewTaskCtrlJ({ ...base, ctrlKey: true, shiftKey: true }, false), false);
  assert.equal(isNewTaskCtrlJ({ ...base, ctrlKey: true, isComposing: true }, false), false);
  assert.equal(isNewTaskCtrlJ({ ...base, ctrlKey: true, code: "KeyK" }, false), false);
});

test("chips fall back when the board has no templates", () => {
  assert.equal(buildNewTaskWriteChips(undefined), FALLBACK_NEW_TASK_WRITE_CHIPS);
  assert.equal(buildNewTaskWriteChips([]), FALLBACK_NEW_TASK_WRITE_CHIPS);
  assert.deepEqual(
    FALLBACK_NEW_TASK_WRITE_CHIPS.map((chip) => chip.label),
    ["Bug report", "Feature", "Acceptance criteria"],
  );
});

test("chips come from the board task templates", () => {
  const chips = buildNewTaskWriteChips([template]);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].label, "Bug report");
  assert.equal(chips[0].template, template);
  assert.match(chips[0].hint, /Template description:\nSteps\nOne/);
});

test("plainTextFromHtml keeps block breaks", () => {
  assert.equal(plainTextFromHtml("<p>A</p><p>B &amp; C</p>"), "A\nB & C");
});

test("plainTextFromHtml never leaves tag text behind and keeps plain less-than signs", () => {
  assert.equal(plainTextFromHtml("<scr<script>ipt>x</script>"), "ipt>x");
  assert.equal(plainTextFromHtml("<p>a &lt;script&gt; b</p>"), "a &lt;script&gt; b");
  assert.equal(plainTextFromHtml("<p>1 < 2 and 3 > 2</p>"), "1 < 2 and 3 > 2");
});

test("new task Ctrl+J yields to AI chat and drops results from a changed board", () => {
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  assert.match(modal, /closest\("#htc, \.chatwindow, \[data-ai-chat-panel\]"\)/);
  assert.match(modal, /latestProjectIdRef\.current !== projectForContext\.id/);
});

test("prompt keeps an existing title and the note", () => {
  const prompt = buildNewTaskWritePrompt("fix login", null, "Login bug");
  assert.match(prompt, /already "Login bug"/);
  assert.match(prompt, /Note:\nfix login/);
});

test("a template chip overrides priority, estimate and labels", () => {
  const labels = [{ id: 5, name: "Bug" }, { id: 6, name: "Other" }];
  const shaped = shapeNewTaskWriteResult(
    { title: "T", description: "<p>d</p>" },
    buildNewTaskWriteChips([template])[0],
    labels,
  );
  assert.deepEqual(shaped.tags, [labels[0]]);
  assert.equal(shaped.priority.priority_index, 1);
  assert.equal(shaped.estimate.estimate_index, 2);
  const untouched = { title: "T", description: "<p>d</p>" };
  assert.equal(shapeNewTaskWriteResult(untouched, null, labels), untouched);
});

test("flag off keeps the old Ctrl+J paths", () => {
  const body = read("src/components/Modals/CreateTaskGloballyModal/CreateTaskModalBody.tsx");
  assert.match(body, /ctrlJSidebarOnNewTask && !\(newTaskCtrlJFlag && !_mbl\)/);
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  assert.match(modal, /const newTaskCtrlJFlag = useFlag\(HTPR_9002_CTRL_J_NEW_TASK_FLAG\)/);
  assert.match(modal, /if \(newTaskCtrlJFlag && !isMbl\) composeShortcutCapture = false;/);
  assert.match(modal, /newTaskCtrlJFlag && newTaskWindow && !isMbl && inlineAiOpen && editor/);
  const float = read("src/components/RTE/Components/InlineDraftAiFloat.tsx");
  assert.match(float, /useFlag\(HTPR_9002_CTRL_J_NEW_TASK_FLAG\)/);
  assert.match(float, /sendLabel = writeMode \? "Write" : "Rewrite"/);
});

test("the Ctrl+J invite reaches the description placeholder through a live ref", () => {
  const tiptap = read("src/components/RTE/Tiptap.ts");
  assert.match(tiptap, /placeholderOverrideRef\?: MutableRefObject<string \| null>/);
  assert.match(tiptap, /\(\) => placeholderOverrideRef\.current \?\? defaultPlaceholder/);
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  assert.match(modal, /placeholderOverrideRef: descriptionPlaceholderRef/);
  assert.match(modal, /descriptionPlaceholderRef\.current = newTaskCtrlJFlag && newTaskWindow && !isMbl/);
  assert.doesNotMatch(modal, /placeholder\.options\.placeholder =/);
});
