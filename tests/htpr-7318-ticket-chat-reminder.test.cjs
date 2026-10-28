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
const flag = "htpr-7318-ticket-chat-reminder";
const skillFlag = "htpr-7800-skill-runs-in-sidebar";
const noop = () => {};
const fixture = [
  { id: "old", title: "Older conversation", userId: 985, taskId: 43, updatedAt: "2024-01-01T12:00:00Z", messages: [{}] },
  { id: "foreign", title: "Teammate private conversation", userId: 986, taskId: 43, updatedAt: "2026-10-24T12:00:00Z", messages: [{}] },
  { id: "second", title: "Second conversation", userId: 985, taskId: 43, updatedAt: "2026-10-20T12:00:00Z", messages: [{}] },
  { id: "fourth", title: "Fourth conversation", userId: 985, taskId: 43, updatedAt: "2023-01-01T12:00:00Z", messages: [{}] },
  { id: "newest", title: "Latest conversation", userId: 985, taskId: 43, updatedAt: "2026-10-23T12:00:00Z", messages: [{}] },
  { id: "empty", title: "Empty session", userId: 985, taskId: 43, updatedAt: "2026-10-25T12:00:00Z", messages: [] },
  { id: "elsewhere", title: "Other ticket", userId: 985, taskId: 44, updatedAt: "2026-10-25T12:00:00Z", messages: [{}] },
];

function load(file, mocks = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (name.startsWith("@/") || name.startsWith(".")) throw new Error(`Unstubbed dependency in ${file}: ${name}`);
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}

function route({ viewer = 985, sessions = fixture } = {}) {
  const queries = [];
  const { GET } = load("src/app/api/ai-chat/task-sessions/route.ts", {
    "@/lib/api/rateLimit": { checkRestRateLimit: async () => null },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => viewer === null ? null : ({ userId: viewer, user: { id: viewer } }) },
    "@/utils/edgeHelpers": { isValidUser: () => ({ isValid: viewer !== null, user: viewer === null ? null : { id: viewer } }) },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "authenticated-cookie" }) }) },
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/prisma": { default: { chatSession: { findMany: async (query) => {
      queries.push(query);
      return sessions.filter(session => Object.entries(query.where).every(([key, value]) => {
        if (key === "messages") return value.some && session.messages.length > 0;
        return session[key] === value;
      })).sort((a, b) => query.orderBy.updatedAt === "desc" ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt) : Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
        .slice(0, query.take).map(session => Object.fromEntries(Object.keys(query.select).filter(key => query.select[key]).map(key => [key, session[key]])));
    } } } },
  });
  return { queries, get: (query = "taskId=43") => GET({ headers: new Headers(), nextUrl: new URL(`https://app.hypertask.ai/api/ai-chat/task-sessions?${query}`) }) };
}

test("server still allows the viewer's three newest nonempty ticket chats, including older chats", async () => {
  const api = route();
  const response = await api.get();
  assert.equal(response.status, 200);
  const { sessions } = await response.json();
  assert.deepEqual(sessions.map(session => session.id), ["newest", "second", "old"]);
  assert.deepEqual(api.queries[0], {
    where: { userId: 985, taskId: 43, messages: { some: {} } },
    select: { id: true, title: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 3,
  });
  assert.deepEqual(Object.keys(sessions[0]).sort(), ["id", "title", "updatedAt"]);
});

test("server still refuses other users' sessions, even with a spoofed userId", async () => {
  const api = route({ viewer: 986 });
  const response = await api.get("taskId=43&userId=985");
  assert.deepEqual((await response.json()).sessions.map(session => session.id), ["foreign"]);
  assert.equal(api.queries[0].where.userId, 986);
  const emptyViewer = route({ viewer: 987 });
  assert.deepEqual((await (await emptyViewer.get()).json()).sessions, []);
});

test("server rejects anonymous and invalid ticket requests before reading sessions", async () => {
  const anonymous = route({ viewer: null });
  assert.equal((await anonymous.get()).status, 401);
  assert.deepEqual(anonymous.queries, []);
  for (const query of ["", "taskId=0", "taskId=invalid"]) {
    const api = route();
    assert.equal((await api.get(query)).status, 400);
    assert.deepEqual(api.queries, []);
  }
});

async function withReminder(options, check) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-15/43" });
  const previous = ["window", "document", "CustomEvent", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map(name => [name, Object.getOwnPropertyDescriptor(global, name)]);
  Object.assign(global, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
  const atoms = Object.fromEntries(["currentUserAtom", "showAIChatInterfaceAtom", "aiChatAutoOpenSuppressedAtom", "aiChatExplicitOpenAtAtom", "isAiChatSidebarModeAtom", "aiChatEditTaskIdAtom", "currentProjectAtom", "aiChatSidebarWidthPxAtom"].map(name => [name, name]));
  const values = { currentUserAtom: { id: options.viewer ?? 985 }, showAIChatInterfaceAtom: false, aiChatAutoOpenSuppressedAtom: true, aiChatEditTaskIdAtom: 43, currentProjectAtom: { id: 15 } };
  const requests = [], selected = [], resumedEvents = [], openWrites = [];
  let enabled = options.enabled !== false;
  let skillEnabled = options.skillEnabled === true;
  let taskId = 43;
  let restored = 0;
  let chat = options.cold ? undefined : { chatHistoryReady: true };
  let nativeTarget = null;
  const runtime = () => ({ chatHistoryReady: options.historyReady !== false, currentSession: { id: "active", messages: [] },
    selectSession: id => selected.push(id), restoreChat: () => { restored++; }, fileItems: [],
    editor: { getHTML: () => "", getText: () => "", commands: { setContent: noop } }, resetFiles: noop,
    startNewSession: () => assert.fail("Resume must not create a session"),
  });
  if (chat) chat = runtime();
  const mocks = {
    "@/hooks/useFlag": { useFlag: key => key === "htpr-8048-agent-sessions" ? false : key === skillFlag ? skillEnabled : key === flag ? enabled : true },
    "@/lib/flags/definitions/htpr-7766-chat-shortcuts": { HTPR_7766_CHAT_SHORTCUTS_FLAG: "htpr-7766-chat-shortcuts" },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/definitions/htpr-7318-ticket-chat-reminder": { HTPR_7318_TICKET_CHAT_REMINDER_FLAG: flag },
    "@/lib/contexts/Multipages/AI_Agent/chatContext": { useOptionalAiChatContext: () => chat },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => chat },
    "@/lib/state": { useRecoilValue: atom => values[atom], useSetRecoilState: atom => value => { openWrites.push({ atom, value }); values[atom] = value; }, useRecoilState: () => [360, noop] },
    "@/store": atoms,
    "next/navigation": { usePathname: () => "/detail/project-15/43", useSearchParams: () => new URLSearchParams() },
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "./GuestBoardSpotlight": { GuestBoardSpotlight: () => null },
    "@/utils/generateTime": { default: value => value },
    "./taskSummaryAction": { taskSummaryActionFor: () => null },
    "@/lib/flags/keys": {},
    "@/hooks/General/useHydrated": { useHydrated: () => true },
  };
  const welcome = load("src/components/AI_CHAT/WelcomeScreen.tsx", mocks);
  const { TicketChatSessionsReminder } = load("src/components/PageComponents/TaskDetail/CommentAndDescription/TicketChatSessionsReminder.tsx", { ...mocks, "@/components/AI_CHAT/WelcomeScreen": welcome });
  let Sidebar = () => null;
  if (options.sidebar) {
    Sidebar = load("src/components/AI_CHAT/AI_Chat_Sidebar.tsx", {
      ...mocks,
      "@/lib/flags/definitions/htpr-8048-agent-sessions": { HTPR_8048_AGENT_SESSIONS_FLAG: "htpr-8048-agent-sessions" },
      "@/lib/flags/definitions/htpr-7800-skill-runs-in-sidebar": { HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG: skillFlag },
      "@/lib/flags/definitions/htpr-7688-past-chats-first": { HTPR_7688_PAST_CHATS_FIRST_FLAG: "past-chats" },
      "@/app/agents/chat/AgentChatClient": { default: () => React.createElement("div", { "data-external-chat": true }) },
      "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: noop },
      "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => nativeTarget, setNativeSidebarChat: target => { nativeTarget = target; } },
      "@/utils/api/ai_chat/aiChatHelpers": { AI_Chat_API: {} },
      "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
      "./MessageList": { MessageList: () => React.createElement("div", { "data-ai-chat": true }) },
      "./WelcomeScreen": { WelcomeScreen: () => null },
      "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
      "./ChatHeader": { ChatHeader: ({ sidebarChats }) => React.createElement("button", { "data-open-agent": true, onClick: () => sidebarChats.onSelect({ kind: "external-agent", agent: { id: "agent", displayName: "Runner", runtimeType: "EXTERNAL" } }) }, "Open agent") },
      "./AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
      "./AiChatSidebarResizeHandle": { AiChatSidebarResizeHandle: () => null },
      "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 320 },
      "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    }).AI_Chat_Sidebar;
  }
  window.addEventListener("ht-ticket-chat-resume", event => resumedEvents.push(event.detail.sessionId));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let reactRoot;
  try {
    global.fetch = async (url, init) => {
      if (url.startsWith("/api/agent-sidebar-chats")) return { ok: true, json: async () => ({ success: true, agents: [{ id: "agent", displayName: "Runner", runtimeType: "EXTERNAL" }] }) };
      requests.push({ url, credentials: init.credentials });
      return route({ viewer: values.currentUserAtom.id, sessions: options.sessions ?? fixture }).get(new URL(url, "https://app.hypertask.ai").searchParams.toString());
    };
    reactRoot = createRoot(document.getElementById("root"));
    const render = async () => {
      await React.act(async () => reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(React.Fragment, null,
        React.createElement(TicketChatSessionsReminder, { taskId }), React.createElement(Sidebar)))));
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    };
    await render();
    await check({ requests, selected, values, resumedEvents, openWrites, client, render,
      get restored() { return restored; },
      ready: async () => { chat = { ...runtime(), chatHistoryReady: true }; await render(); },
      settled: async () => { chat = { ...chat, sendSettledVersion: (chat.sendSettledVersion ?? 0) + 1 }; await render(); },
      disable: async () => { enabled = false; await render(); },
      disableSkill: async () => { skillEnabled = false; await render(); },
      viewer: async id => { values.currentUserAtom = { id }; await render(); },
      ticket: async id => { taskId = id; await render(); },
    });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    client.clear();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    dom.window.close();
  }
}

const block = () => document.querySelector("section[aria-label='You chatted about this ticket']");
const rows = () => [...block().querySelectorAll("button")];

test("reminder shows only the viewer's latest three threads, newest first, and resumes an older thread in the panel", async () => {
  await withReminder({}, async view => {
    assert.equal(block().querySelector("h2").textContent, "You chatted about this ticket");
    assert.equal(block().querySelector("p").textContent, "Only you see this");
    assert.deepEqual(rows().map(row => row.querySelector("span").textContent), ["Latest conversation", "Second conversation", "Older conversation"]);
    assert.deepEqual(view.requests, [{ url: "/api/ai-chat/task-sessions?taskId=43", credentials: "include" }]);
    await React.act(async () => {
      rows()[2].click();
      assert.deepEqual(view.openWrites, []);
      assert.deepEqual(view.selected, []);
    });
    assert.deepEqual(view.openWrites.map(write => write.atom), [
      "aiChatEditTaskIdAtom", "isAiChatSidebarModeAtom", "aiChatAutoOpenSuppressedAtom", "aiChatExplicitOpenAtAtom", "showAIChatInterfaceAtom",
    ]);
    assert.deepEqual(view.selected, ["old"]);
    assert.deepEqual(view.resumedEvents, ["old"]);
    assert.equal(view.restored, 1);
    assert.equal(view.values.showAIChatInterfaceAtom, true);
    assert.equal(view.values.isAiChatSidebarModeAtom, true);
    assert.equal(view.values.aiChatAutoOpenSuppressedAtom, false);
    assert.equal(view.values.aiChatEditTaskIdAtom, null);
    assert.ok(view.values.aiChatExplicitOpenAtAtom > 0);
  });
});

test("no sessions and flag off render nothing; flag off does not fetch or expose cached rows", async () => {
  for (const options of [{ sessions: [] }, { viewer: 987 }, { enabled: false }]) {
    await withReminder(options, async view => {
      assert.equal(block(), null);
      assert.equal(view.requests.length, options.enabled === false ? 0 : 1);
      assert.deepEqual(view.selected, []);
    });
  }
  await withReminder({}, async view => {
    assert.ok(block());
    await view.disable();
    assert.equal(block(), null);
    assert.equal(view.requests.length, 1);
  });
});

test("changing viewers cannot reuse the previous viewer's cached private threads", async () => {
  await withReminder({}, async view => {
    assert.equal(rows().length, 3);
    await view.viewer(986);
    assert.deepEqual(rows().map(row => row.querySelector("span").textContent), ["Teammate private conversation"]);
    assert.equal(view.client.getQueryData(["task-sessions", 43, 985]), undefined);
    assert.equal(view.client.getQueryData(["task-sessions", 43, 986]).length, 1);
    await view.viewer(987);
    assert.equal(block(), null);
  });
});

test("a newly completed ticket chat refreshes the reminder without reloading the page", async () => {
  const sessions = [];
  await withReminder({ sessions }, async view => {
    assert.equal(block(), null);
    sessions.push({ ...fixture[4], id: "just-created", title: "Just chatted" });
    await view.settled();
    assert.deepEqual(rows().map(row => row.querySelector("span").textContent), ["Just chatted"]);
    assert.equal(view.requests.length, 2);
  });
});

test("a cold chat runtime resumes once it becomes ready, without losing the clicked thread", async () => {
  await withReminder({ cold: true }, async view => {
    await React.act(async () => rows()[1].click());
    assert.deepEqual(view.selected, []);
    assert.equal(view.values.showAIChatInterfaceAtom, true);
    await view.ready();
    assert.deepEqual(view.selected, ["second"]);
    assert.equal(view.restored, 1);
    assert.equal(view.openWrites.length, 5);
    await view.render();
    assert.equal(view.restored, 1);
    assert.equal(view.openWrites.length, 5);
  });
});

test("a mounted chat waits for history before dispatching resume and opens only once", async () => {
  await withReminder({ historyReady: false }, async view => {
    await React.act(async () => rows()[0].click());
    assert.equal(view.values.showAIChatInterfaceAtom, true);
    assert.equal(view.openWrites.length, 5);
    assert.deepEqual(view.resumedEvents, []);
    assert.deepEqual(view.selected, []);
    assert.equal(view.restored, 0);
    await view.ready();
    assert.deepEqual(view.resumedEvents, ["newest"]);
    assert.deepEqual(view.selected, ["newest"]);
    assert.equal(view.restored, 1);
    assert.equal(view.openWrites.length, 5);
  });
});

test("a pending resume does not open a thread after switching ticket, viewer, closing chat or disabling the flag", async () => {
  for (const cancel of [view => view.ticket(44), view => view.viewer(986), view => view.disable(), async view => { view.values.showAIChatInterfaceAtom = false; await view.render(); }]) {
    await withReminder({ cold: true }, async view => {
      await React.act(async () => rows()[0].click());
      await cancel(view);
      await view.ready();
      assert.deepEqual(view.selected, []);
    });
  }
});

test("resuming a ticket thread replaces an open external agent panel with the AI conversation", async () => {
  await withReminder({ sidebar: true }, async view => {
    await React.act(async () => document.querySelector("[data-open-agent]").click());
    assert.ok(document.querySelector("[data-external-chat]"));
    await React.act(async () => rows()[0].click());
    assert.deepEqual(view.selected, ["newest"]);
    assert.equal(document.querySelector("[data-external-chat]")?.parentElement.classList.contains("hidden"), true);
    assert.ok(document.querySelector("[data-ai-chat]"));
  });
});

test("flag off leaves the sidebar resume event unhandled and does not open chat", async () => {
  for (const enabled of [false, true]) {
    await withReminder({ enabled, sidebar: true }, async view => {
      if (enabled) await view.disable();
      const event = new CustomEvent("ht-ticket-chat-resume", { cancelable: true, detail: { sessionId: "newest" } });
      assert.equal(window.dispatchEvent(event), true);
      assert.equal(event.defaultPrevented, false);
      assert.equal(block(), null);
      assert.deepEqual(view.selected, []);
      assert.deepEqual(view.openWrites, []);
      assert.equal(view.restored, 0);
    });
  }
});

test("skill flag alone handles resume until switched off, then leaves resume unhandled", async () => {
  for (const skillEnabled of [false, true]) {
    await withReminder({ enabled: false, skillEnabled, sidebar: true }, async view => {
      if (skillEnabled) {
        const event = new CustomEvent("ht-ticket-chat-resume", { cancelable: true, detail: { sessionId: "newest" } });
        await React.act(async () => { assert.equal(window.dispatchEvent(event), false); });
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(view.selected, ["newest"]);
        await view.disableSkill();
      }
      const event = new CustomEvent("ht-ticket-chat-resume", { cancelable: true, detail: { sessionId: "old" } });
      assert.equal(window.dispatchEvent(event), true);
      assert.equal(event.defaultPrevented, false);
      assert.deepEqual(view.selected, skillEnabled ? ["newest"] : []);
      assert.deepEqual(view.openWrites, []);
      assert.equal(view.restored, 0);
    });
  }
});

test("feature flag defaults to Everyone and is discovered by the generated registry", () => {
  const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false, interopDefault: true });
  const definition = jiti(path.join(root, `src/lib/flags/definitions/${flag}.ts`));
  const value = definition.default ?? definition;
  const keys = jiti(path.join(root, "src/lib/flags/keys.ts"));
  const { FEATURE_FLAG_DEFINITIONS } = jiti(path.join(root, "src/lib/flags/definitions.ts"));
  assert.equal(value.key, flag);
  assert.equal(value.kind, "feature");
  assert.equal(value.defaultMode, "EVERYONE");
  assert.equal(value.shippedOn, "2026-10-24");
  assert.equal(value.releaseRisk.risk, "small");
  assert.ok(value.releaseRisk.reason.trim());
  assert.equal(value.releaseRisk.highRisk, undefined);
  assert.equal(keys.HTPR_7318_TICKET_CHAT_REMINDER_FLAG, flag);
  assert.deepEqual(FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === flag), value);
});
