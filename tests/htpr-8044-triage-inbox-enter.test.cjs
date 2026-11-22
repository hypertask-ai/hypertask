const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const { tmpdir } = require("node:os");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const { findCommandPosition } = loadModule("src/components/Modals/commands/HTC/commandSelection.ts");
const { KeyCodes } = loadModule("src/lib/constants/keyboard-handler.ts");
const { buildFullScreenChatPath } = loadModule("src/lib/aiChatDisplayMode.ts");
const { INBOX_TRIAGE_PROMPT } = loadModule("src/lib/ai/prompts/inboxTriage.ts");

const inboxFile = path.join(root, "src/components/notifications/inboxSplit/index.tsx");
const inboxSource = ts.createSourceFile(inboxFile, fs.readFileSync(inboxFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const commandsFile = path.join(root, "src/components/Modals/commands/HTC/commands.tsx");
const commandsSource = ts.createSourceFile(commandsFile, fs.readFileSync(commandsFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function find(tree, source, predicate) {
  let found;
  function visit(node) {
    if (!found && predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, "production entry point exists");
  return found.getText(source);
}

const inboxKeyDown = `const ${find(
  inboxSource,
  inboxSource,
  (node) => ts.isVariableDeclaration(node) && node.name.getText(inboxSource) === "handleKeyDown" && node.getText(inboxSource).includes("KeyCodes.ENTER"),
)}`;

const paletteEnterHandlers = [];
function visitCommands(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(commandsSource) === "onKeyDown" &&
      ts.isJsxExpression(node.initializer) && node.initializer.expression &&
      node.initializer.expression.getText(commandsSource).includes("updateCommandFrequency")) {
    paletteEnterHandlers.push(node.initializer.expression.getText(commandsSource));
  }
  ts.forEachChild(node, visitCommands);
}
visitCommands(commandsSource);

const chooseCommand = find(
  commandsSource,
  commandsSource,
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "updateCommandFrequency",
);

function compile(text, bindings) {
  const names = Object.keys(bindings);
  const dir = fs.mkdtempSync(path.join(tmpdir(), "triage-enter-"));
  const file = path.join(dir, "boundary.ts");
  fs.writeFileSync(file, `const { ${names.join(", ")} } = require(${JSON.stringify(path.join(dir, "bindings.cjs"))});\nmodule.exports = (${text});`);
  fs.writeFileSync(path.join(dir, "bindings.cjs"), "module.exports = global.__triageEnterBindings;");
  global.__triageEnterBindings = bindings;
  try {
    return loadModule(file);
  } finally {
    delete global.__triageEnterBindings;
  }
}

const triageCommand = { key: "triageInbox", name: "Triage inbox" };

function inboxBindings(dom, show, opened) {
  return {
    value: 0,
    index: 0,
    Element: dom.window.Element,
    isApple: false,
    controller: {},
    selectedKeyboardNotificationIndex: null,
    bulkHandleKeyDown: () => ({}),
    returnIfModalOrInputActive: () => false,
    showCommands: { show },
    document: dom.window.document,
    classNamesToReturnFrom: ["modal-open", "ProseMirror ProseMirror-focused", undefined],
    KeyCodes,
    lastgClick: { current: null },
    inboxConfig: { interactions: { keyboard: { gKeyDelayMs: 400 } } },
    selectedKeyboardRow: { item: { kind: "notification" } },
    openTask: (mode) => { opened.push(mode); },
    openDraft: () => { opened.push("draft"); },
  };
}

function mountInbox(dom, show) {
  const opened = [];
  const bindings = inboxBindings(dom, show, opened);
  const source = `const { ${Object.keys(bindings).join(", ")} } = require(${JSON.stringify(path.join(tmpdir(), "unused"))});\n${inboxKeyDown}\nmodule.exports = handleKeyDown;`;
  const dir = fs.mkdtempSync(path.join(tmpdir(), "triage-enter-"));
  const file = path.join(dir, "inbox.ts");
  const bindingsFile = path.join(dir, "bindings.cjs");
  fs.writeFileSync(bindingsFile, "module.exports = global.__triageEnterBindings;");
  fs.writeFileSync(file, source.replace(path.join(tmpdir(), "unused"), bindingsFile));
  global.__triageEnterBindings = bindings;
  try {
    return { press: loadModule(file), opened };
  } finally {
    delete global.__triageEnterBindings;
  }
}

function page() {
  const dom = new JSDOM("<!doctype html><html><body><input id='htc-search'></body></html>", { url: "https://app.hypertask.ai/inbox" });
  const document = dom.window.document;
  const input = document.getElementById("htc-search");
  return { dom, document, input };
}

function enterOn(dom, target) {
  target.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Enter",
    keyCode: KeyCodes.ENTER,
    bubbles: true,
    cancelable: true,
  }));
}

test("Enter from the palette field does not open the highlighted inbox ticket after the field blurs", () => {
  const { dom, document, input } = page();
  input.focus();
  input.blur();
  assert.equal(document.activeElement.tagName, "BODY");
  const inbox = mountInbox(dom, false);
  document.addEventListener("keydown", inbox.press);
  enterOn(dom, input);
  assert.deepEqual(inbox.opened, []);
});

test("Enter on the inbox page still opens the highlighted ticket", () => {
  const { dom, document } = page();
  const inbox = mountInbox(dom, false);
  document.addEventListener("keydown", inbox.press);
  enterOn(dom, document.body);
  assert.deepEqual(inbox.opened, ["view"]);
});

test("Ctrl+K Triage inbox Enter on the inbox page starts the chat and does not open a ticket", () => {
  assert.equal(paletteEnterHandlers.length, 2);
  for (const handlerSource of paletteEnterHandlers) {
    const { dom, document, input } = page();
    input.focus();
    const opened = [];
    let inbox = mountInbox(dom, true);
    const attach = (press) => document.addEventListener("keydown", press);
    const detach = (press) => document.removeEventListener("keydown", press);
    attach(inbox.press);
    const calls = [];
    const choose = compile(chooseCommand, {
      writing: false,
      removeImageGeneration: false,
      findCommandPosition,
      filterCommands: [{ group: "Inbox", commandLists: [triageCommand] }],
      isDemo: false,
      isInteractive: false,
      rightColumnFlag: false,
      scope: undefined,
      addFieldPayload: undefined,
      setFrequentlyUsed: () => {},
      recordHTCCommandUsage: () => ({}),
      document,
      pagesEnabled: false,
      standalonePages: false,
      triageInboxFlag: true,
      safeInboxBatches: true,
      freshChatHandoff: true,
      resetShowCommands: () => {
        detach(inbox.press);
        inbox = mountInbox(dom, false);
        attach(inbox.press);
        calls.push("close");
      },
      setAiChatPendingPrompt: (prompt) => calls.push(prompt),
      INBOX_TRIAGE_PROMPT,
      buildFullScreenChatPath,
      window: { location: { pathname: "/inbox", search: "", hash: "" } },
      router: { push: (href) => calls.push(href) },
    });
    const onKeyDown = compile(handlerSource, { selectedCommand: triageCommand, updateCommandFrequency: choose });
    input.addEventListener("keydown", (native) => {
      onKeyDown({
        key: native.key,
        keyCode: native.keyCode,
        target: native.target,
        preventDefault() { native.preventDefault(); },
        stopPropagation() { native.stopPropagation(); },
        nativeEvent: native,
      });
    });
    enterOn(dom, input);
    assert.deepEqual(inbox.opened, []);
    assert.deepEqual(calls, [
      "close",
      { query: INBOX_TRIAGE_PROMPT, fullScreen: true },
      "/chat?return_to=%2Finbox",
    ]);
  }
});
