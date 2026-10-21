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
const flag = "htpr-7317-ctrlj-ticket-questions";
const intro = { id: "compose-task-43", role: "assistant", content: "I created QASA-43 from your note. Want me to refine it?" };
let enabled = true;
let session = { id: "s1", taskId: 43, messages: [intro] };
const sent = [];
const mocks = {
  "@/hooks/useFlag": { useFlag: (key) => enabled && key === flag },
  "@/lib/flags/keys": { HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG: flag },
  "./MessageItem": { MessageItem: ({ message }) => React.createElement("div", { "data-message": message.id }, message.content) },
  "./TypingIndicator": { TypingIndicator: () => React.createElement("span", { "data-typing": "" }) },
  "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": {
    useAiChatContext: () => ({
      chatMounted: true, handleMessageListScroll: () => {}, registerMessageListRef: () => {}, scrollMessagesToBottom: () => {},
      currentSession: session, isTyping: false, handleSendMessage: (message) => sent.push(message),
    }),
  },
};
const compiled = ts.transpileModule(read("src/components/AI_CHAT/MessageList.tsx"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
new Function("require", "exports", compiled)((name) => mocks[name] ?? require(name), exportsObject);

async function renderList(answer) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-6859/43" });
  const previous = { window: global.window, document: global.document, fetch: global.fetch, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  global.fetch = async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return answer(); };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const reactRoot = createRoot(document.getElementById("root"));
  await React.act(async () => reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(exportsObject.MessageList))));
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const chips = [...document.querySelectorAll("[data-compose-question]")];
  return {
    requests, chips, text: document.body.textContent,
    cleanup: async () => {
      await React.act(async () => reactRoot.unmount());
      client.clear();
      Object.assign(global, { window: previous.window, document: previous.document, fetch: previous.fetch, IS_REACT_ACT_ENVIRONMENT: previous.act });
    },
  };
}

const ok = (questions) => ({ ok: true, json: async () => ({ questions }) });

test("Ctrl+J intro gets ticket-specific chips from the new-ticket questions request; a click sends the chip", async () => {
  enabled = true; session = { id: "s1", taskId: 43, messages: [intro] }; sent.length = 0;
  const view = await renderList(() => ok(["Which boards get the sidebar first?", "Add steps for the empty sidebar"]));
  try {
    assert.deepEqual(view.requests, [{ url: "/api/ai/task-questions", body: { taskId: 43, kind: "new-ticket" } }]);
    assert.deepEqual(view.chips.map((chip) => chip.textContent), ["Which boards get the sidebar first?", "Add steps for the empty sidebar"]);
    assert.equal(view.chips[0].className, "bg-kanban-active-cardbg hover:bg-hover-active rounded p-2 text-xs text-left w-full");
    await React.act(async () => view.chips[1].click());
    assert.deepEqual(sent, ["Add steps for the empty sidebar"]);
  } finally { await view.cleanup(); }
});

test("no generic fallback chips when the route returns nothing or fails", async () => {
  for (const answer of [() => ok([]), () => ({ ok: false, json: async () => ({}) })]) {
    enabled = true; session = { id: "s1", taskId: 43, messages: [intro] };
    const view = await renderList(answer);
    try {
      assert.equal(view.chips.length, 0);
      assert.doesNotMatch(view.text, /Questions and ideas|Summarize|next steps/);
      assert.match(view.text, /I created QASA-43/);
    } finally { await view.cleanup(); }
  }
});

test("no request and no chips with the flag off, once the user replied, or for a batch of tickets", async () => {
  const cases = [
    { flagOn: false, messages: [intro] },
    { flagOn: true, messages: [intro, { id: "m2", role: "human", content: "Shorten the title" }] },
    { flagOn: true, messages: [{ ...intro, content: "<p>I created 2 tickets from your note.</p>" }] },
    { flagOn: true, messages: [{ ...intro, id: "other-message" }] },
  ];
  for (const { flagOn, messages } of cases) {
    enabled = flagOn; session = { id: "s1", taskId: 43, messages };
    const view = await renderList(() => ok(["Should never render"]));
    try {
      assert.equal(view.requests.length, 0);
      assert.equal(view.chips.length, 0);
    } finally { await view.cleanup(); }
  }
});

test("route asks a dedicated new-ticket prompt for at most 4 items; the default path keeps its prompt", () => {
  const route = read("src/app/api/ai/task-questions/route.ts");
  assert.match(route, /kind: z\.enum\(\["next-move", "new-ticket"\]\)\.default\("next-move"\)/);
  assert.match(route, /renderPrompt\("task-questions-new-ticket-prompt-1", \(task\.title\), \(task\.section\), \(description \|\| "\(empty\)"\)\)/);
  assert.match(route, /renderPrompt\("task-questions-prompt-2", \(viewerBlock\)/);
  assert.match(route, /\.slice\(0, newTicket \? 4 : 5\)/);
  const prompts = read("src/lib/ai/prompts/definitions.ts");
  assert.match(prompts, /Produce 2 to 4 short prompts/);
  assert.match(prompts, /Never suggest generic actions/);
});

test("flag ships on Everyone with a feature kind", () => {
  const definition = read("src/lib/flags/definitions/htpr-7317-ctrlj-ticket-questions.ts");
  assert.match(definition, /kind: "feature"/);
  assert.match(definition, /defaultMode: "EVERYONE"/);
});
