const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function load(file, mocks = {}) {
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const flag = load("src/lib/flags/definitions/htpr-7773-chat-header-name.ts");

for (const mobile of [false, true]) {
  test(`${mobile ? "phone" : "desktop"} header follows the active chat without changing agent titles or flag-Off behavior`, async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/chat" });
    const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
    const previous = globals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
    global.window = dom.window;
    global.document = dom.window.document;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
    const chats = ["triage done column", "Release checklist"].map((title, index) => ({
      id: `chat-${index}`, title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
    let enabled = true;
    const noop = () => {};
    const state = {
      sessions: chats, currentSession: chats[0], currentAiOption: {}, isSidebarMode: true,
      selectSession: (id) => { state.currentSession = chats.find((chat) => chat.id === id); },
    };
    const tooltip = () => ({});
    const { ChatHeader } = load("src/components/AI_CHAT/ChatHeader.tsx", {
      react: React,
      "react/jsx-runtime": require("react/jsx-runtime"),
      "lucide-react": require("lucide-react"),
      "date-fns": require("date-fns"),
      "next/navigation": { usePathname: () => "/chat", useRouter: () => ({ push: noop }), useSearchParams: () => new URLSearchParams() },
      "@/hooks/useFlag": { useFlag: (key) => key === flag.HTPR_7773_CHAT_HEADER_NAME_FLAG && enabled },
      "@/lib/flags/keys": { HTPR_6971_CHAT_HISTORY_PAGING_FLAG: "htpr-6971-chat-history-paging" },
      "@/lib/flags/definitions/htpr-7773-chat-header-name": flag,
      "@/lib/flags/definitions/htpr-7575-phone-chat-delete": { HTPR_7575_PHONE_CHAT_DELETE_FLAG: "htpr-7575-phone-chat-delete" },
      "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => state },
      "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px]" },
      "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
      "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { new_chat_button: tooltip, minimize_button: tooltip, toggle_sidebar_button: tooltip } } } },
      "@/lib/aiChatDisplayMode": { buildFullScreenChatPath: () => "/chat" },
      "@/lib/aiModelOptions": { getMobileAiChatModelLabel: () => "AI" },
      "@/lib/state": { useRecoilState: () => [false, noop] },
      "@/store": {},
      "react-hot-toast": { __esModule: true, default: { error: noop } },
      "../Common/Tooltip": { __esModule: true, default: () => null },
      "./AgentSidebarChatCommands": { AgentSidebarChatCommands: () => null },
    });
    const container = document.getElementById("root");
    const renderer = createRoot(container);
    let sidebarChats = { projectId: 15, target: { kind: "ai" }, agents: [], onSelect: noop };
    const render = () => React.act(async () => renderer.render(React.createElement(ChatHeader, { sidebarChats })));
    const title = () => container.querySelector(sidebarChats ? '[aria-label="Switch conversation"]' : mobile ? ".truncate.px-2" : "button > span.truncate");
    try {
      await render();
      assert.equal(title().textContent, "triage done column");
      await React.act(async () => container.querySelector('[aria-label="Chat history"]').click());
      const rows = [...container.querySelectorAll("#ai-chat-session-history li button")];
      assert.deepEqual(rows.map((row) => row.textContent), ["triage done column", "Release checklist"]);
      await React.act(async () => rows[1].click());
      await render();
      assert.equal(title().textContent, "Release checklist");
      await React.act(async () => container.querySelector('[aria-label="Chat history"]').click());
      await React.act(async () => container.querySelector("#ai-chat-session-history li button").click());
      await render();
      assert.equal(title().textContent, "triage done column");

      const longTitle = "A long renamed chat title ".repeat(20);
      state.currentSession = { ...chats[0], title: longTitle };
      await render();
      assert.equal(title().textContent, longTitle);
      assert.equal(title().querySelector("span").classList.contains("truncate"), true);
      if (!mobile) assert.equal(title().title, longTitle);

      for (const name of [null, undefined, ""]) {
        state.currentSession = { ...chats[0], title: name };
        await render();
        assert.equal(title().textContent, "AI chat");
      }
      state.currentSession = undefined;
      await render();
      assert.equal(title().textContent, "AI chat");
      state.currentSession = chats[0];
      enabled = false;
      await render();
      assert.equal(title().textContent, "AI chat");

      enabled = true;
      for (const kind of ["external-agent", "native-agent"]) {
        sidebarChats = { ...sidebarChats, target: { kind, agent: { displayName: "Product Lead" } } };
        await render();
        assert.equal(title().textContent, "Product Lead");
      }

      sidebarChats = undefined;
      for (const flagEnabled of [true, false]) {
        enabled = flagEnabled;
        for (const chat of chats) {
          state.currentSession = chat;
          await render();
          assert.equal(title().textContent, chat.id === "chat-0" ? "triage done column" : "Release checklist");
        }
        state.currentSession = undefined;
        await render();
        assert.equal(title().textContent, "AI Chat");
      }
    } finally {
      await React.act(async () => renderer.unmount());
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
      }
      dom.window.close();
    }
  });
}
