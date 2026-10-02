const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");

const atoms = { currentProjectAtom: "project", inViewObjectAtom: "task", taskDetailNonEssentialReadyAtom: "ready" };
let dataReady = true;
const sent = [];
const mocks = {
  "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ isDetailPage: true, handleSendMessage: (message) => sent.push(message) }) },
  "next/navigation": { usePathname: () => "/detail/project-6859/43" },
  "@/lib/state": { useRecoilValue: (atom) => atom === "task" ? { taskId: 43, taskTicketNumber: "QASA-43" } : atom === "ready" ? dataReady : null },
  "@/store": atoms,
  "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
  "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
  "./GuestBoardSpotlight": { GuestBoardSpotlight: () => null },
  "@/utils/generateTime": { __esModule: true, default: () => "now" },
  "./taskSummaryAction": { taskSummaryActionFor: () => null },
  "@/hooks/General/useHydrated": { useHydrated: () => true },
};
const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../src/components/AI_CHAT/WelcomeScreen.tsx"), "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
new Function("require", "exports", compiled)((name) => mocks[name] ?? require(name), exportsObject);

for (const initiallyReady of [false, true]) {
  test(`default ticket questions are actionable ${initiallyReady ? "during" : "before"} the AI request, then generated questions replace them`, async () => {
    const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-6859/43" });
    const previous = { window: global.window, document: global.document, fetch: global.fetch, act: global.IS_REACT_ACT_ENVIRONMENT };
    global.window = dom.window;
    global.document = dom.window.document;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    dataReady = initiallyReady;
    sent.length = 0;
    let resolveQuestions;
    const questions = new Promise((resolve) => { resolveQuestions = resolve; });
    const requests = [];
    global.fetch = (url) => {
      requests.push(url);
      return url === "/api/ai/task-questions" ? questions : Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const reactRoot = createRoot(document.getElementById("root"));
    const render = () => reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(exportsObject.WelcomeScreen)));
    try {
      await React.act(async () => render());
      assert.equal(document.querySelectorAll(".animate-pulse").length, 0, "pending questions must never replace usable defaults with grey bars");
      assert.equal(document.querySelectorAll("button").length, 4);
      const button = document.querySelector("button");
      assert.match(button.textContent, /QASA-43/);
      await React.act(async () => button.click());
      assert.deepEqual(sent, [button.textContent]);
      if (!initiallyReady) {
        assert.equal(requests.length, 0, "background requests still wait for ticket readiness");
        dataReady = true;
        await React.act(async () => render());
      }
      assert.ok(requests.includes("/api/ai/task-questions"));
      await React.act(async () => {
        resolveQuestions({ ok: true, json: async () => ({ questions: ["Generated question A", "Generated question B"] }) });
        await client.fetchQuery({ queryKey: ["task-questions", 43] });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.match(document.body.textContent, /Generated question A/);
      assert.match(document.body.textContent, /Ask all/);
      assert.equal(document.querySelectorAll(".animate-pulse").length, 0);
    } finally {
      await React.act(async () => reactRoot.unmount());
      client.clear();
      global.window = previous.window;
      global.document = previous.document;
      global.fetch = previous.fetch;
      global.IS_REACT_ACT_ENVIRONMENT = previous.act;
      dom.window.close();
    }
  });
}
