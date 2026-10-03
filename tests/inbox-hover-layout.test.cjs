const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const clsx = require("clsx");
const { twMerge } = require("tailwind-merge");

const root = path.resolve(__dirname, "..");
const rowPath = "src/components/notifications/NotificationRow.tsx";

// Render production row, title, chips, controls and context without app/network
// dependencies. Only non-layout services, tooltips and unused avatar are stubbed.
function createFixture(source = fs.readFileSync(path.join(root, rowPath), "utf8")) {
  const cache = new Map();
  const { window } = new JSDOM("");
  const empty = () => null;
  const mocks = {
    "@/utils/undoActions/helperFuncs": { cn: (...args) => twMerge(clsx(args)) },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": { INBOX_ARCHIVE_CLUSTER_FLAG: "inbox-archive-cluster" },
    "@/lib/inboxClusters": { inboxArchiveTooltip: () => "Archive" },
    "@/lib/nativeAgent/agentMessageEnvelope": { decodeAgentMessage: (text) => text },
    "@/utils/helperFunctions/helperFunctions": {
      convertToPlain: (html) => html.replace(/<[^>]*>/g, ""),
      returnIfModalOrInputActive: () => false,
    },
    "@/lib/waitingOn": { formatWaitingOnAge: () => "1 day" },
    "@/lib/constants": { __esModule: true, default: { PriorityConstants: [], EstimateConstants: [] } },
    "@/lib/contexts/Inbox/BulkSelectionContext": { useBulkSelectionContext: () => ({ selectedNotifications: [] }) },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const compiledModule = { exports: {} };
    cache.set(file, compiledModule);
    const text = file === path.join(root, rowPath) ? source : fs.readFileSync(file, "utf8");
    const code = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: file,
    }).outputText;
    const localRequire = (id) => {
      if (mocks[id]) return mocks[id];
      if (/Tooltip$|UserAvatar$|RemindMeComponent$/.test(id)) return { __esModule: true, default: empty };
      if (id.startsWith("@/") || id.startsWith(".")) {
        const base = id.startsWith("@/") ? path.join(root, "src", id.slice(2)) : path.resolve(path.dirname(file), id);
        const resolved = [base + ".tsx", base + ".ts", path.join(base, "index.tsx"), path.join(base, "index.ts")].find(fs.existsSync);
        assert.ok(resolved, `resolve ${id}`);
        return load(resolved);
      }
      return require(id);
    };
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: localRequire, React, window, document: window.document, DOMParser: window.DOMParser, console }, { filename: file });
    return compiledModule.exports;
  }
  const Row = load(path.join(root, rowPath)).default;
  const { NotificationProvider } = load(path.join(root, "src/lib/contexts/NotificationContext.tsx"));
  const Checkbox = load(path.join(root, "src/components/Common/selection-checkbox.tsx")).default;
  const notification = {
    id: 6883, type: "Comment", userId: 1, seen: true,
    createdAt: new Date(Date.now() - 7 * 60 * 1000),
    fromUser: { displayName: "Sender" }, comment: { text: "Message preview that should never move on hover" },
    task: { title: "Inbox hover stability", ticketNumber: "HTPR-6883", taskLabels: [
      { label: { value: "hard" } }, { label: { value: "FEATURE" } },
    ] },
  };
  function render({ selected = false, disableButtons = false, selectedIds = [], type = "Comment", timestamp } = {}) {
    const item = { ...notification, type, commentId: type === "Mentioned" ? 6883 : undefined, ...(timestamp ? { createdAt: timestamp } : {}) };
    return renderToStaticMarkup(React.createElement(NotificationProvider, {
      notification: item, selectedSplit: "Important", isIbxSlctd: selectedIds.length > 0, selectedIds, displayAvatar: "Hide",
    }, React.createElement("div", { className: `group/selection_row relative flex items-center md:gap-[0px] md:border-l-4 md:pr-[48px] ${selected ? "md:bg-active-elementBg border-l-selected-item-border" : "md:border-l-transparent bg-transparent"}`, id: "selection-row" },
      React.createElement("div", { className: "inbox-row-gutter hidden shrink-0 items-center justify-end gap-2 pr-[1px] md:flex" },
        React.createElement(Checkbox, { isChecked: false, alwaysVisible: false, onClick() {} })),
      React.createElement("div", { className: "min-w-0 flex-1" }, React.createElement(Row, {
        selected, disableButtons, taskRef: { current: null }, index: 0,
        handleMouseEnter() {}, handleMouseLeave() {}, openTask() {}, markAsDone() {}, eHandler() {},
      })))));
  }
  return { render };
}

module.exports = { createFixture, rowPath };

if (require.main === module) {
  const fixture = createFixture(process.env.INBOX_ROW_SOURCE ? fs.readFileSync(process.env.INBOX_ROW_SOURCE, "utf8") : undefined);
  const row = (options) => new JSDOM(fixture.render(options)).window.document.querySelector("#inbox-6883");
  test("hover and keyboard selection keep the same three outer flex children", () => {
    const resting = row();
    const selected = row({ selected: true });
    assert.equal(resting.children.length, 3);
    assert.equal(selected.children.length, 3, "controls must not change the outer space-x sibling margins");
    assert.deepEqual([...selected.children].map((el) => el.className), [...resting.children].map((el) => el.className));
  });
  test("desktop timestamp and existing icons share one fixed non-shrinking slot", () => {
    const selected = row({ selected: true });
    const slot = selected.lastElementChild;
    assert.match(slot.className, /md:min-w-\[62px\]/);
    assert.match(slot.className, /md:shrink-0/);
    assert.match(slot.className, /hidden md:block/);
    assert.equal(slot.querySelectorAll("button").length, 2);
    assert.match(slot.querySelector("span").className, /md:invisible/);
    assert.equal(slot.querySelectorAll("svg").length, 2);
    assert.match(slot.querySelector("button").parentElement.className, /absolute right-0/);
  });
  test("disabled actions preserve the timestamp and bulk selection suppresses icons", () => {
    const disabled = row({ selected: true, disableButtons: true });
    assert.equal(disabled.querySelectorAll("button").length, 0);
    assert.doesNotMatch([...disabled.querySelectorAll("span")].at(-1).className, /md:invisible/);
    const bulk = row({ selected: true, selectedIds: [6883] });
    assert.match(bulk.querySelector("button").parentElement.className, /!invisible/);
  });
}
