const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { createPortal } = require("react-dom");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { buildInboxQueryCache } = jiti(path.join(root, "src/utils/helperFunctions/inboxHelpers.ts"));
const { updateInboxOptimistically } = jiti(path.join(root, "src/lib/inboxSync/optimistic.ts"));
const { QueryClient } = require("@tanstack/react-query");

function fixture(mobile, shortcutPeers = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/inbox?split=All" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const cache = new Map();
  const requests = [];
  const navigation = [];
  const inView = { taskId: 6946, taskProjectId: 7049 };
  const atoms = { currentUserAtom: { value: { id: 985 } }, inViewObjectAtom: { value: inView }, lastUsedReminderAtom: { value: null }, globalNotificationFocusAtom: { value: { currSplit: 0, currIdx: 0 } } };
  const queryKey = ["inbox", "data", 985];
  const queryClient = new QueryClient();
  const notification = (id, taskId) => ({ id: String(id), taskId, userId: 985, projectId: 7049, type: "TaskMovedToInbox", seen: false, status: "Normal", createdAt: new Date().toISOString(), project: { id: 7049, title: "QA Sandbox" }, task: { id: taskId, title: "QA task", projectId: 7049 } });
  queryClient.setQueryData(queryKey, buildInboxQueryCache([notification(1, 6946), notification(2, 6946), notification(3, 6947)], [], false));
  const reconciliations = [];
  queryClient.invalidateQueries = async (options) => { reconciliations.push(options); };
  const portal = ({ children }) => createPortal(React.createElement("div", { role: "dialog" }, children), document.body);
  const box = ({ children }) => React.createElement("div", null, children);
  const options = [
    { display: "Later today", date: "2026-10-05T19:00:00.000Z" },
    { display: "Tomorrow", date: "2026-10-06T07:00:00.000Z" },
  ];
  const mocks = {
    "@/store": atoms,
    "@/lib/state": { useRecoilState: (atom) => React.useState(atom.value), useRecoilValue: (atom) => atom.value, useSetRecoilState: () => () => {} },
    "next/navigation": { useRouter: () => ({ refresh: () => navigation.push("refresh"), replace: (url) => navigation.push(url) }), usePathname: () => "/inbox", useSearchParams: () => new URLSearchParams() },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/hooks/General/useUndo": { useUndoContext: () => ({ performActionAndStoreUndoData() {} }) },
    "axios": { default: { post: async (url, body) => { requests.push({ url, body }); return { status: 200 }; } } },
    "@/utils/axiosClient": { default: {} },
    "@/lib/realtime/client": { realtimeEchoHeaders: () => ({}) },
    "@/hooks/Inbox/useGetNotifications": { inboxDataQueryKey: (id) => ["inbox", "data", id] },
    "@/lib/inboxSync/optimistic": { updateInboxOptimistically },
    "@/lib/constants": { default: { gThenKeyDelay: 1000 } },
    "@/lib/constants/constants": { reminderDropOptions: [{ type: "DurationComplete" }] },
    "@/lib/contexts/Inbox/BulkSelectionContext": { useBulkSelectionContext: () => ({ selectedNotifications: [] }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => Boolean(document.querySelector('[role="dialog"]')) },
    "@/hooks/General/useGetTimeOptions": { default: () => ({ getRemindMeOptions: () => options }) },
    "@/hooks/MultiPages/useQueryState": { default: (_key, initial) => React.useState(initial) },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": { MY_TASKS_SNOOZE_FLAG: "htpr-6461-my-tasks-snooze" },
    "@/utils/helperFunctions/dateParse": { inputChange: () => [] },
    "@/utils/generateTime": { default: () => "tomorrow" },
    "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
    "@/components/Common/Tooltip": { default: () => null },
    "@/styles/linksModal.module.scss": { default: {} },
    "reactstrap": { ModalBody: box },
    "react-hot-toast": { default: Object.assign(() => {}, { error() {} }) },
    "@/components/Modals/Sheets": { MobileBottomSheet: portal },
    "@/components/Common/CommonModalComponents": {
      ModalContainerCustom: portal,
      ModalHintBar: () => null,
      ModalInput: (props) => React.createElement("input", props),
      ModalRowElementContainer: ({ children, onClick, onMouseEnter, id, role }) => React.createElement("li", { onClick, onMouseEnter, id, role }, children),
    },
  };
  function load(relative) {
    const file = path.join(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const compiledModule = { exports: {} };
    cache.set(file, compiledModule);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
    }).outputText;
    const localRequire = (id) => {
      if (Object.hasOwn(mocks, id)) return { __esModule: true, ...mocks[id] };
      if (id.startsWith("@/") || id.startsWith(".")) {
        const base = id.startsWith("@/") ? `src/${id.slice(2)}` : path.relative(root, path.resolve(path.dirname(file), id));
        const alias = "@/" + base.slice(4);
        if (Object.hasOwn(mocks, alias)) return { __esModule: true, ...mocks[alias] };
        const resolved = [base + ".tsx", base + ".ts"].find((name) => fs.existsSync(path.join(root, name)));
        assert.ok(resolved, `resolve ${id}`);
        return load(resolved);
      }
      return require(id);
    };
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: localRequire, React, document, window, URLSearchParams, setTimeout, clearTimeout, console }, { filename: file });
    return compiledModule.exports;
  }
  const Remind = load("src/components/notifications/inboxSplit/RemindMeInbox.tsx").default;
  const Row = load("src/components/Common/TaskRowComponents/TaskRowContainer.tsx").default;
  const reactRoot = createRoot(document.getElementById("root"));
  act(() => reactRoot.render(React.createElement(React.Fragment, null,
    shortcutPeers && React.createElement(Remind, { show: false }),
    shortcutPeers && React.createElement(Remind, { show: true, mode: "Bulk" }),
    React.createElement(Row, { divId: 1, divType: "inbox", index: 0, selected: true, openTask: () => navigation.push("task detail") },
      React.createElement("span", { id: "title" }, "Own QA task"), React.createElement(Remind, { show: true })))));
  const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  return { requests, navigation, options, queryClient, queryKey, reconciliations, click, close: () => { queryClient.clear(); act(() => reactRoot.unmount()); dom.window.close(); delete global.window; delete global.document; delete global.IS_REACT_ACT_ENVIRONMENT; } };
}

for (const mobile of [false, true]) {
  for (const trigger of ["mouse", "H"]) {
    for (const label of ["Later today", "Tomorrow"]) {
      test(`${mobile ? "phone" : "desktop"} ${trigger}: ${label} consumes the portal click, snoozes once and closes without opening the task`, async () => {
        const f = fixture(mobile);
        try {
          if (trigger === "mouse") await f.click(document.querySelector("#inbox-1 button"));
          else act(() => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "h", keyCode: 72, bubbles: true })));
          assert.ok(document.querySelector('[role="dialog"]'));
          assert.ok(!document.querySelector("#inbox-1 [role=option]"), "picker options live in a DOM portal outside the row");
          const option = [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent.startsWith(label));
          await f.click(option);
          assert.equal(f.requests.length, 1);
          assert.equal(f.requests[0].url, "/api/queues/inboxReminder");
          const payload = f.queryClient.getQueryData(f.queryKey);
          assert.deepEqual(payload.notifications.map((row) => row.taskId), [6947], "snoozing removes the task and its sibling notifications only");
          assert.ok(payload.structuredData.tabs.every((tab) => tab.length === 1), "tab counts and lists update together");
          assert.deepEqual(Array.from(f.reconciliations[0].queryKey), f.queryKey);
          assert.equal(f.reconciliations[0].exact, true);
          assert.equal(f.requests[0].body.taskId, 6946);
          assert.equal(f.requests[0].body.projectId, 7049);
          assert.equal(f.requests[0].body.userId, 985);
          assert.equal(f.requests[0].body.remindAt, f.options.find((o) => o.display === label).date);
          assert.ok(!f.navigation.includes("task detail"), "React portal events must not open the parent Inbox row");
          assert.equal(document.querySelector('[role="dialog"]'), null);
          await f.click(document.querySelector("#title"));
          assert.ok(f.navigation.includes("task detail"), "ordinary row clicks must still open the task");
        } finally { f.close(); }
      });
    }
  }
}

test("H is owned by one visible Remind trigger, even before mobile sheets commit", async () => {
  const f = fixture(true, true);
  try {
    act(() => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "h", keyCode: 72, bubbles: true, cancelable: true })));
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1, "hidden and already-consumed triggers must not open extra sheets");
    await f.click(document.querySelector('[role="option"]'));
    assert.equal(f.requests.length, 1);
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
    assert.ok(!f.navigation.includes("task detail"));
  } finally { f.close(); }
});
