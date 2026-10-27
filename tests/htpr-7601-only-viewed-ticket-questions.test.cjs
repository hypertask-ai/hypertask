const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const questionsFlag = "htpr-7317-ctrlj-ticket-questions";
const viewedFlag = "htpr-7601-only-viewed-ticket-questions";
const intro = (taskId) => ({ id: `compose-task-${taskId}`, role: "assistant", content: `I created QASA-${taskId} from your note. Want me to refine it?` });
let flags = new Set();
let viewedTaskId = null;
let session = null;
const mocks = {
  "@/store": { composeTaskQuestionsTaskIdAtom: "questionsTaskId", inViewObjectAtom: "inView" },
  "@/lib/state": {
    useRecoilValue: (atom) => (atom === "inView" ? { taskId: viewedTaskId } : null),
    useSetRecoilState: () => () => {},
  },
  "@/hooks/useFlag": { useFlag: (key) => flags.has(key) },
  "@/lib/flags/keys": { HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG: questionsFlag, HTPR_7601_ONLY_VIEWED_TICKET_QUESTIONS_FLAG: viewedFlag },
  "./MessageItem": { MessageItem: ({ message }) => React.createElement("div", { "data-message": message.id }, message.content) },
  "./TypingIndicator": { TypingIndicator: () => React.createElement("span", { "data-typing": "" }) },
  "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": {
    useAiChatContext: () => ({
      chatMounted: true, handleMessageListScroll: () => {}, registerMessageListRef: () => {}, scrollMessagesToBottom: () => {},
      currentSession: session, isTyping: false, handleSendMessage: () => {},
    }),
  },
};
const compiled = ts.transpileModule(read("src/components/AI_CHAT/MessageList.tsx"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
new Function("require", "exports", compiled)((name) => mocks[name] ?? require(name), exportsObject);

async function renderList() {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-8190/22" });
  const previous = { window: global.window, document: global.document, fetch: global.fetch, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ questions: ["Shorten the title", "Add a symptom section"] }) };
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const reactRoot = createRoot(document.getElementById("root"));
  await React.act(async () => reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(exportsObject.MessageList))));
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const chips = document.querySelectorAll("[data-compose-question]").length;
  await React.act(async () => reactRoot.unmount());
  client.clear();
  Object.assign(global, { window: previous.window, document: previous.document, fetch: previous.fetch, IS_REACT_ACT_ENVIRONMENT: previous.act });
  return { requests, chips };
}

test("now refused: the previous Ctrl+J ticket's session shown while a new ticket is in view sends no questions request", async () => {
  flags = new Set([questionsFlag, viewedFlag]);
  viewedTaskId = 67988;
  session = { id: "old", taskId: 67986, messages: [intro(67986)] };
  const view = await renderList();
  assert.deepEqual(view.requests, []);
  assert.equal(view.chips, 0);
});

test("still allowed: the new ticket's own session asks once and shows its questions", async () => {
  flags = new Set([questionsFlag, viewedFlag]);
  viewedTaskId = 67988;
  session = { id: "new", taskId: 67988, messages: [intro(67988)] };
  const view = await renderList();
  assert.deepEqual(view.requests, [{ taskId: 67988, kind: "new-ticket" }]);
  assert.equal(view.chips, 2);
});

test("still allowed: with no ticket in view the session's questions load as today", async () => {
  flags = new Set([questionsFlag, viewedFlag]);
  viewedTaskId = null;
  session = { id: "board", taskId: 67986, messages: [intro(67986)] };
  const view = await renderList();
  assert.deepEqual(view.requests, [{ taskId: 67986, kind: "new-ticket" }]);
});

test("flag off keeps today's request for the other ticket's session", async () => {
  flags = new Set([questionsFlag]);
  viewedTaskId = 67988;
  session = { id: "old", taskId: 67986, messages: [intro(67986)] };
  const view = await renderList();
  assert.deepEqual(view.requests, [{ taskId: 67986, kind: "new-ticket" }]);
});

test("flag ships as a bugfix on Everyone", () => {
  const definition = read("src/lib/flags/definitions/htpr-7601-only-viewed-ticket-questions.ts");
  assert.match(definition, /kind: "bugfix"/);
  assert.match(definition, /defaultMode: "EVERYONE"/);
});
