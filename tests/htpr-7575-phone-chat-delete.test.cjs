const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const phoneFlag = "htpr-7575-phone-chat-delete";
const pagingFlag = "htpr-6971-chat-history-paging";

async function withHistory({ enabled = true, mobile = true, paging = false } = {}, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/project" });
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = keys.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
  let rows = [
    { id: "active", title: "Active chat", updatedAt: new Date().toISOString() },
    { id: "older", title: "Older chat", updatedAt: "2020-01-01T00:00:00.000Z" },
  ];
  let currentSession = rows[0];
  let confirmed = false;
  const prompts = [], deleted = [], selected = [];
  window.confirm = (message) => { prompts.push(message); return confirmed; };
  const state = {
    get sessions() { return rows; },
    get historySessions() { return rows; },
    get currentSession() { return currentSession; },
    isSidebarMode: true,
    refreshHistorySessions: async () => {},
    selectSession: (id) => { selected.push(id); currentSession = rows.find((row) => row.id === id); },
    deleteSession: async (id) => {
      deleted.push(id);
      rows = rows.filter((row) => row.id !== id);
      if (currentSession?.id === id) currentSession = rows[0];
    },
  };
  const tooltip = () => ({ text: "", keyCombination: [] });
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": require("lucide-react"),
    "date-fns": require("date-fns"),
    "next/navigation": { usePathname: () => "/project", useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
    "./AgentSidebarChatCommands": { AgentSidebarChatCommands: () => null },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => state },
    "@/hooks/useFlag": { useFlag: (key) => key === phoneFlag ? enabled : key === pagingFlag && paging },
    "@/lib/flags/keys": { HTPR_6971_CHAT_HISTORY_PAGING_FLAG: pagingFlag },
    "@/lib/flags/definitions/htpr-7575-phone-chat-delete": { HTPR_7575_PHONE_CHAT_DELETE_FLAG: phoneFlag },
    "../Common/Tooltip": { __esModule: true, default: ({ children }) => children },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px] shrink-0 flex items-center justify-center" },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { new_chat_button: tooltip, minimize_button: tooltip } } } },
    "@/lib/aiChatDisplayMode": { buildFullScreenChatPath: () => "/chat" },
    "@/lib/aiModelOptions": { getMobileAiChatModelLabel: () => "AI" },
    "@/lib/state": { useRecoilState: () => [false, () => {}] },
    "react-hot-toast": { __esModule: true, default: { error() {} } },
    "@/store": {},
  };
  let root;
  try {
    const source = fs.readFileSync(path.join(__dirname, "../src/components/AI_CHAT/ChatHeader.tsx"), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const loaded = { exports: {} };
    new Function("require", "module", "exports", compiled)((name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    }, loaded, loaded.exports);
    const container = document.getElementById("root");
    root = createRoot(container);
    const render = () => React.act(async () => root.render(React.createElement(loaded.exports.ChatHeader)));
    const click = (element) => React.act(async () => element.click());
    const open = () => click(container.querySelector(mobile ? '[aria-label="Chat history"]' : "button[title]"));
    const titles = () => [...container.querySelectorAll("#ai-chat-session-history li")].map((row) => row.querySelector("button").textContent.trim());
    await render();
    await open();
    await run({ container, click, open, render, titles, prompts, deleted, selected, confirm: (value) => { confirmed = value; },
      remount: async () => {
        await React.act(async () => root.unmount());
        root = createRoot(container);
        await render();
        await open();
      },
    });
  } finally {
    if (root) await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

for (const paging of [false, true]) {
  test(`phone history confirms the exact row without selecting it, paging ${paging}`, async () => {
    await withHistory({ paging }, async ({ container, click, render, titles, prompts, deleted, selected, confirm, remount }) => {
      const buttons = () => [...container.querySelectorAll('#ai-chat-session-history [aria-label="Delete chat"]')];
      assert.deepEqual(titles(), ["Active chat", "Older chat"]);
      assert.equal(buttons().length, 2);
      assert.equal(container.querySelector("button button"), null);
      assert.ok(buttons()[1].classList.contains("min-h-[44px]"));
      assert.ok(buttons()[1].classList.contains("min-w-[44px]"));
      await click(buttons()[1]);
      assert.deepEqual(prompts, ["Delete this chat?"]);
      assert.deepEqual(deleted, []);
      assert.deepEqual(selected, []);
      assert.deepEqual(titles(), ["Active chat", "Older chat"]);
      confirm(true);
      await click(buttons()[1]);
      assert.deepEqual(deleted, ["older"]);
      assert.deepEqual(selected, []);
      await render();
      assert.deepEqual(titles(), ["Active chat"]);
      await remount();
      assert.deepEqual(titles(), ["Active chat"]);
      await click(buttons()[0]);
      assert.deepEqual(deleted, ["older", "active"]);
      await render();
      assert.deepEqual(titles(), []);
    });
  });
}

test("flag Off and desktop keep selection-only history; flag On gives phone rows delete", async () => {
  for (const options of [{ enabled: false }, { mobile: false }, { enabled: true }]) {
    await withHistory(options, async ({ container, click, titles, selected }) => {
      assert.deepEqual(titles(), ["Active chat", "Older chat"]);
      assert.equal(container.querySelectorAll('#ai-chat-session-history [aria-label="Delete chat"]').length,
        options.enabled === false || options.mobile === false ? 0 : 2);
      await click(container.querySelector("#ai-chat-session-history li button"));
      assert.deepEqual(selected, ["active"]);
      assert.equal(container.querySelector("#ai-chat-session-history"), null);
    });
  }
});
