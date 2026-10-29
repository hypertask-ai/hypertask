const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const pointerKey = "htpr-7549-first-task-pointer";
const overlayKey = "htpr-7550-connect-overlay";
const keys = { HTPR_7549_FIRST_TASK_POINTER_FLAG: pointerKey, HTPR_7550_CONNECT_OVERLAY_FLAG: overlayKey };
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const response = (data, ok = true) => ({ ok, json: async () => data });

function server(overrides = {}) {
  const state = { userId: 6, pointer: true, overlay: true, project: { firstTaskPointerTaskId: 71, firstTaskPointerSectionId: 10, firstRealTaskCreatedAt: null }, count: 0, section: { id: 10 }, firstBoard: 7, connected: false, dismissed: false, ...overrides };
  const calls = [];
  const connection = load("src/lib/onboarding/agentConnection.ts", {
    "@prisma/client": { LogType: { Signup: "Signup" }, Status: { Normal: "Normal" } },
    "@/lib/prisma": { logs: {
      findFirst: async ({ where }) => where.OR ? (state.connected ? { log: "mcp_connected:codex", createdAt: new Date(0) } : null) : (state.dismissed ? { id: 1 } : null),
      create: async ({ data }) => { assert.equal(data.LoggedById, state.userId); assert.equal(data.log, "agent_connect_dismissed"); state.dismissed = true; },
    }, project: { findFirst: async ({ where, orderBy }) => { assert.equal(where.ownerId, state.userId); assert.deepEqual(orderBy, { id: "asc" }); return { id: state.firstBoard }; } } },
    "@/lib/flags": { isFeatureEnabled: async (key, id) => { assert.equal(id, state.userId); calls.push(key); return key === pointerKey ? state.pointer : key === overlayKey ? state.overlay : false; } },
    "@/lib/flags/keys": keys,
    "@/lib/onboarding/qaArm": {}, "@/lib/redis": {}, "@/lib/email/sendEmail": {},
    "@/lib/onboarding/emails/agentConnected": {}, "@/utils/controllers/notifications/emailTemplates": {}, "@/lib/telemetry/activationAnalytics": {},
  });
  const api = load("src/app/api/projects/first-task-pointer/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => state.userId ? { userId: state.userId, agentId: state.agentId } : null },
    "@/lib/flags": { isFeatureEnabled: async (key) => { assert.equal(key, pointerKey); return state.pointer; } },
    "@/lib/flags/keys": keys,
    "@/lib/onboarding/agentConnection": connection,
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({ ownerId: state.userId }) },
    "@/lib/prisma": { project: { findFirst: async ({ where }) => { assert.equal(where.ownerId, state.userId); assert.equal(where.seeded, true); return state.project; } }, task: { count: async () => state.count }, section: { findFirst: async () => state.section } },
  });
  const status = load("src/app/api/users/ai-connection-status/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => state.userId ? { id: state.userId } : null },
    "@/lib/onboarding/agentConnection": connection,
  });
  const request = (overlay = true) => ({ headers: new Headers(), nextUrl: new URL(`https://fixture.test/api/projects/first-task-pointer?projectId=7${overlay ? "&connectOverlay=1" : ""}`) });
  return { state, calls, get: (overlay = true) => api.GET(request(overlay)), status, dismiss: () => status.POST({ nextUrl: new URL("https://fixture.test/api/users/ai-connection-status?mode=overlay") }) };
}

for (const [name, patch] of [
  ["later board", { firstBoard: 3 }], ["already connected", { connected: true }], ["persisted dismissal", { dismissed: true }],
  ["unenrolled board", { project: { firstTaskPointerTaskId: null } }], ["first real task", { count: 1 }],
  ["completed milestone", { project: { firstTaskPointerTaskId: 71, firstTaskPointerSectionId: 10, firstRealTaskCreatedAt: new Date(0) } }],
  ["missing target", { section: null }], ["foreign board", { project: null }], ["agent session", { agentId: "fixture-agent" }],
  ["anonymous", { userId: null }], ["7549 off", { pointer: false }], ["7550 off", { overlay: false }],
]) {
  test(`${name} is refused next to an eligible first-starter-board control`, async () => {
    assert.equal((await server().get()).body.eligible, true);
    assert.equal((await server(patch).get()).body.eligible, false);
  });
}

test("7550 off leaves the existing 7549 response unchanged and refuses overlay dismissal", async () => {
  const allowed = server();
  assert.equal((await allowed.dismiss()).status, 200);
  assert.equal(allowed.state.dismissed, true);
  assert.equal((await allowed.get()).body.eligible, false);
  const off = server({ overlay: false });
  assert.deepEqual((await off.get(false)).body, { eligible: true, starterTaskId: 71, sectionId: 10 });
  assert.deepEqual(off.calls, []);
  assert.equal((await off.dismiss()).status, 404);
  assert.equal(off.state.dismissed, false);
});

test("flag copies Owner-only rollout and registry/keys use the generated definition", async () => {
  const definition = load("src/lib/flags/definitions/htpr-7550-connect-overlay.ts");
  const previous = load("src/lib/flags/definitions/htpr-7549-first-task-pointer.ts");
  assert.equal(definition.HTPR_7550_CONNECT_OVERLAY_FLAG, overlayKey);
  assert.equal(definition.default.defaultMode, "OWNER_ONLY");
  assert.deepEqual(definition.default.releaseRisk.ownerRequest, previous.default.releaseRisk.ownerRequest);
  assert.equal(definition.default.releaseRisk.highRisk, "access");
  assert.equal(definition.default.releaseRisk.risk, "new");
  assert.match(definition.default.releaseRisk.reason, /MCP credential provisioning/);
  const registry = load("src/lib/flags.ts", {
    "@/lib/prisma": {}, "@/lib/flags/definitions": { FEATURE_FLAG_DEFINITIONS: [definition.default] }, "@/lib/flags/keys": {},
  });
  for (const [id, email, expected] of [[6, "valentin.yeo@gmail.com", true], [985, "valentin@hypertask.ai", false], [2343, "normal@example.test", false], [2343, "valentin.yeo@gmail.com", false]]) {
    const db = { featureFlag: { findUnique: async () => null }, user: { findUnique: async () => ({ email }) } };
    assert.equal(await registry.isFeatureEnabled(overlayKey, id, db), expected);
  }
  assert.match(read("src/lib/flags/keys.ts"), /export \* from "\.\/definitions\/index.generated"/);
  assert.match(read("scripts/generate-flag-index.mjs"), /export \{ \$\{identifier\} \}/);
});

test("boards outside the starter lookup are ordinary overlay ineligibility, without changing pointer-only status", async () => {
  assert.equal((await server().get()).body.eligible, true);
  assert.deepEqual(await server({ project: null }).get(), { body: { eligible: false }, status: 200 });
  assert.deepEqual(await server({ project: null }).get(false), { body: { eligible: false }, status: 404 });
  assert.equal((await server({ userId: null }).get()).status, 401);
  assert.equal((await server({ agentId: "fixture-agent" }).get()).status, 401);
});

function isOverlayActive(overlay, overrides = {}) {
  const source = read("src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx");
  const expression = source.match(/const connectOverlayActive = ([\s\S]*?);/);
  assert.ok(expression);
  const scope = {
    connectOverlayEnabled: true, composeEnabled: true, connectOverlay: overlay, overlaySectionId: overlay.sectionId, tasksHydrated: true, secondaryStartupEnabled: true,
    _currentProject: { ownerId: 6 }, currentUser: { id: 6 }, pointerFiltered: false, pointerTaskIds: [71],
    displaySections: [{ sectionId: 10 }], hiddenSectionIndexes: new Set(), ...overrides,
  };
  return Function(...Object.keys(scope), `return ${expression[1]}`)(...Object.values(scope));
}

async function withDOM(fn) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://fixture.test/project?id=7", pretendToBeVisual: true });
  const names = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "getComputedStyle", "fetch", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names.slice(0, 7)) Object.defineProperty(global, name, { configurable: true, writable: true, value: name === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : name === "window" ? dom.window : dom.window[name] });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  try { await fn({ dom, root, act: React.act }); }
  finally {
    await React.act(async () => root.unmount());
    await Promise.resolve();
    dom.window.close();
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(global, name, descriptor); else delete global[name]; }
  }
}

async function withBoard(fn, overrides = {}) {
  await withDOM(async (domContext) => {
    const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const state = { pointer: true, overlay: true, ready: true, eligible: true, dismissOk: true, pending: false, ...overrides };
    const requests = [];
    let release;
    let pickerProps;
    global.fetch = async (url, options = {}) => {
      requests.push([url, options]);
      if (options.method === "POST") { if (state.dismissOk) state.eligible = false; return response({}, state.dismissOk); }
      if (state.pending) await new Promise((resolve) => { release = resolve; });
      if (state.requestError) throw new Error("Fixture request failed");
      return response({ eligible: state.eligible, sectionId: 10 }, state.requestOk !== false);
    };
    const { useConnectAgentOverlay } = load("src/hooks/useConnectAgentOverlay.ts", {
      "@tanstack/react-query": require("@tanstack/react-query"),
      "@/hooks/useFlag": { useFlag: (key) => key === pointerKey ? state.pointer : state.overlay, useFlagReady: () => state.ready },
      "@/lib/flags/keys": keys,
    });
    const sharedModal = load("src/components/Common/CommonModalComponents/index.tsx", {
      "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
      "@/styles/linksModal.module.scss": { links_modal: "" },
      "@/hooks/MultiPages/useClickOutside": { __esModule: true, default: () => {} },
    });
    const { ConnectAgentOverlay } = load("src/components/PageComponents/Onboarding/ConnectAgentOverlay.tsx", {
      "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, overlayKey); return state.overlay; } },
      "@/lib/flags/keys": keys,
      "@/components/Common/CommonModalComponents": sharedModal,
      "next/dynamic": () => (props) => { pickerProps = props; return React.createElement("button", { onClick: props.onConnected }, "Fixture agent connected"); },
    });
    function Board({ projectId = 7, userId = 6, active = true }) {
      const overlay = useConnectAgentOverlay(projectId, userId, active);
      const overlayActive = isOverlayActive(overlay, state.activation);
      return React.createElement(React.Fragment, null,
        React.createElement("main", { id: "board" }, "Visible starter board"),
        React.createElement("div", { id: "droppable-section-container-10" }, React.createElement("div", { className: "create-new-task-button" }, "+")),
        !overlayActive && React.createElement("section", { id: "inline-card" }, "Legacy inline card"),
        state.pointer && !overlay.blocked && React.createElement("button", { id: "pointer" }, "Write your first task here"),
        overlayActive && React.createElement(ConnectAgentOverlay, { sectionId: overlay.sectionId, onClose: overlay.close }));
    }
    const render = async (props = {}) => domContext.act(async () => domContext.root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Board, props))));
    const settle = async () => domContext.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    try { await fn({ ...domContext, state, requests, render, settle, release: () => release(), picker: () => pickerProps, client }); }
    finally { client.clear(); }
  });
}

for (const close of ["escape", "skip", "connected"]) {
  test(`${close} closes the reused modal before revealing the pointer and inline card`, async () => {
    await withBoard(async ({ dom, act, render, settle, requests, picker }) => {
      await render(); await settle();
      const modal = document.querySelector('[role="dialog"]');
      assert.ok(modal);
      assert.ok(document.getElementById("board"));
      assert.equal(document.getElementById("pointer"), null);
      assert.equal(document.getElementById("inline-card"), null);
      assert.equal(picker().compact, true);
      assert.equal(picker().overlay, true);
      await act(async () => {
        if (close === "escape") modal.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "Escape", keyCode: 27, bubbles: true }));
        else if (close === "skip") [...modal.querySelectorAll("button")].find((button) => button.textContent === "Skip").click();
        else picker().onConnected();
      });
      await settle();
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.ok(document.getElementById("pointer"));
      assert.ok(document.getElementById("inline-card"));
      assert.equal(requests.filter(([, options]) => options.method === "POST").length, close === "connected" ? 0 : 1);
      assert.equal(document.activeElement.className, "create-new-task-button");
    });
  });
}

test("pending eligibility withholds the pointer but preserves inline fallback; explicit flag OFF keeps the old path", async () => {
  await withBoard(async ({ state, render, settle, release, requests }) => {
    await render();
    assert.equal(document.getElementById("pointer"), null);
    assert.ok(document.getElementById("inline-card"));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    state.pending = false;
    await React.act(async () => release()); await settle();
    assert.ok(document.querySelector('[role="dialog"]'));
    state.overlay = false;
    await render(); await settle();
    assert.ok(document.getElementById("pointer"));
    assert.ok(document.getElementById("inline-card"));
    assert.equal(requests.length, 1);
  }, { pending: true });
  await withBoard(async ({ render, requests }) => {
    await render();
    assert.ok(document.getElementById("pointer"));
    assert.ok(document.getElementById("inline-card"));
    assert.equal(requests.length, 0);
  }, { overlay: false });
});

test("7550 OFF keeps production behavior even before flag readiness", async () => {
  await withBoard(async ({ state, render, requests }) => {
    await render();
    assert.ok(document.getElementById("pointer"));
    assert.ok(document.getElementById("inline-card"));
    assert.equal(requests.length, 0);
    state.ready = true; await render(); assert.ok(document.getElementById("pointer"));
  }, { overlay: false, ready: false });
});

for (const [name, overrides] of [["network error", { requestError: true }], ["HTTP error", { requestOk: false }], ["ineligible board", { eligible: false }]]) {
  test(`${name} reveals the pointer and inline fallback next to an eligible blocking control`, async () => {
    await withBoard(async ({ render, settle }) => {
      await render(); await settle();
      assert.ok(document.querySelector('[role="dialog"]'));
      assert.equal(document.getElementById("pointer"), null);
      assert.equal(document.getElementById("inline-card"), null);
    });
    await withBoard(async ({ render, settle }) => {
      await render(); await settle();
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.ok(document.getElementById("pointer"));
      assert.ok(document.getElementById("inline-card"));
    }, overrides);
  });
}

for (const [name, activation] of [
  ["compose off", { composeEnabled: false }], ["filtered board", { pointerFiltered: true }],
  ["hidden target section", { hiddenSectionIndexes: new Set([0]) }], ["missing target section", { displaySections: [{ sectionId: 20 }] }],
  ["tasks not hydrated", { tasksHydrated: false }], ["startup not ready", { secondaryStartupEnabled: false }],
  ["non-owner", { _currentProject: { ownerId: 9 } }], ["non-starter tasks", { pointerTaskIds: null }],
]) {
  test(`${name} keeps inline fallback next to a still-allowed visible starter overlay`, async () => {
    await withBoard(async ({ render, settle }) => {
      await render(); await settle();
      assert.ok(document.querySelector('[role="dialog"]'));
      assert.equal(document.getElementById("inline-card"), null);
    });
    await withBoard(async ({ render, settle }) => {
      await render(); await settle();
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.ok(document.getElementById("inline-card"));
    }, { activation });
  });
}

test("shared modal traps focus; failed skip stays open with retry and hidden picker stops being visible", async () => {
  await withBoard(async ({ dom, state, render, settle, act, picker }) => {
    await render(); await settle();
    const modal = document.querySelector('[role="dialog"]');
    const buttons = [...modal.querySelectorAll("button")];
    buttons.at(-1).focus();
    modal.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", keyCode: 9, which: 9, bubbles: true, cancelable: true }));
    assert.equal(document.activeElement, buttons[0]);
    const outside = document.getElementById("board");
    outside.tabIndex = 0;
    outside.focus();
    assert.ok(modal.contains(document.activeElement));
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(picker().visible, false);
    await act(async () => buttons[0].click());
    assert.match(document.querySelector('[role="alert"]').textContent, /Could not dismiss/);
    assert.equal(document.getElementById("pointer"), null);
    state.dismissOk = true;
    await act(async () => buttons[0].click()); await settle();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.ok(document.getElementById("pointer"));
  }, { dismissOk: false });
});

test("ineligible and table boards keep inline behavior, while enabled eligible Kanban still opens", async () => {
  await withBoard(async ({ render, settle }) => { await render(); await settle(); assert.ok(document.querySelector('[role="dialog"]')); });
  await withBoard(async ({ render, settle }) => { await render(); await settle(); assert.equal(document.querySelector('[role="dialog"]'), null); assert.ok(document.getElementById("pointer")); assert.ok(document.getElementById("inline-card")); }, { eligible: false });
  await withBoard(async ({ render, requests }) => { await render({ active: false }); assert.equal(document.querySelector('[role="dialog"]'), null); assert.ok(document.getElementById("inline-card")); assert.equal(requests.length, 0); });
});

test("integration wires pointer blocking, keeps the independent inline-removal switch, and opts overlay out of token auto-generation", () => {
  const home = read("src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx");
  const landing = read("src/app/[...boardURL]/LandingPage.tsx");
  const screen = read("src/components/PageComponents/Onboarding/Screens/ConnectAIOnboardingScreen.tsx");
  assert.match(home, /filtered=\{pointerFiltered \|\| hiddenSectionIndexes.has\(index\) \|\| \(connectOverlayEnabled && connectOverlay.blocked\)\}/);
  assert.match(home, /const connectOverlayActive = connectOverlayEnabled && composeEnabled && connectOverlay.open/);
  assert.match(home, /\{!connectOverlayActive && inlineConnectCard\}/);
  assert.match(home, /\{connectOverlayActive && \(/);
  assert.match(home, /const connectOverlayEnabled = useFlag\(HTPR_7550_CONNECT_OVERLAY_FLAG\)/);
  assert.match(home, /tasksHydrated && secondaryStartupEnabled/);
  assert.match(home, /displaySections\?\.some/);
  assert.match(landing, /const inlineConnectCard = !connectBlockRemoved && _currentProject && _currentUser\?\.id/);
  assert.match(landing, /\{\(!connectOverlayEnabled \|\| boardLayout === "table"\) && inlineConnectCard\}/);
  assert.match(landing, /inlineConnectCard=\{connectOverlayEnabled \? inlineConnectCard : null\}/);
  assert.match(landing, /connectOverlayEnabled=\{connectOverlayEnabled \? boardRender.boardLayout !== "table" : false\}/);
  assert.doesNotMatch(landing, /useConnectAgentOverlay/);
  assert.match(screen, /overlay=\{overlayEnabled && props.overlay\} onConnected=\{overlayEnabled \? props.onConnected : undefined\}/);
  assert.match(screen, /useMcpToken\(!overlay\)/);
  assert.match(screen, /\(!overlay \|\| visible\) &&/);
  assert.match(screen, /onConnected\?\.\(\)/);
  assert.match(read("src/components/Modals/McpToken/hooks/useMcpToken.ts"), /useEffect\(overlayEnabled && !autoGenerate \? \(\) => \{\} : \(\) =>/);
  assert.match(read("src/components/PageComponents/Onboarding/ConnectAgentOverlay.tsx"), /if \(!overlayEnabled\) return null/);
  assert.match(read("src/hooks/useConnectAgentOverlay.ts"), /if \(!overlayEnabled\) return \{ enabled: false, blocked: false, open: false/);
});

test("the real shared picker polls only while visible, reports actual connection, and never auto-mints an overlay token", async () => {
  await withDOM(async ({ dom, root, act }) => {
    const previous = { setInterval: global.setInterval, clearInterval: global.clearInterval };
    const intervals = new Map();
    let next = 0;
    let connected = false;
    let confirmed = 0;
    let generated = 0;
    const generateToken = () => { generated++; };
    global.setInterval = (fn, ms) => { assert.equal(ms, 4000); const id = ++next; intervals.set(id, fn); return id; };
    global.clearInterval = (id) => intervals.delete(id);
    const requests = [];
    global.fetch = async (url) => { requests.push(url); return response({ eligible: true, connected, client: "Codex" }); };
    const { ConnectAIOnboardingScreen } = load("src/components/PageComponents/Onboarding/Screens/ConnectAIOnboardingScreen.tsx", {
      "@/hooks/useFlag": { useFlag: (key) => key === overlayKey, useFlagReady: () => true },
      "@/lib/flags/keys": keys,
      "@/components/Modals/CliInstall/constants": { INSTALL_COMMAND: "fixture install", LOGIN_COMMAND: "hypertask login" },
      "@/components/Modals/McpToken/components": { getIntegrationChipClassName: () => "text-meta", ConnectInstructions: () => null, TokenStatusBar: () => null },
      "@/components/Modals/McpToken/components/ConnectInstructions": { CopyableCodeBlock: () => null },
      "@/components/Modals/McpToken/hooks/useMcpToken": { useMcpToken: (autoGenerate) => { assert.equal(autoGenerate, false); return { token: null, isLoading: false, isGenerating: false, generateToken }; } },
      "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
      "../GetStartedButton": { GetStartedButton: () => null },
    });
    const onConnected = () => { confirmed++; };
    const render = (visible) => root.render(React.createElement(ConnectAIOnboardingScreen, { compact: true, overlay: true, visible, onConnected, onNextScreen() {} }));
    try {
      await act(async () => render(false));
      assert.equal(requests.length, 0);
      assert.equal(intervals.size, 0);
      const tool = [...document.querySelectorAll("button")].find((button) => button.textContent === "Codex");
      await act(async () => tool.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
      assert.equal(generated, 0);
      assert.equal(confirmed, 0);
      await act(async () => render(true));
      assert.equal(generated, 1);
      assert.equal(intervals.size, 1);
      assert.equal(requests.at(-1), "/api/users/ai-connection-status?mode=overlay");
      await act(async () => render(false));
      assert.equal(intervals.size, 0);
      await act(async () => render(true));
      assert.equal(intervals.size, 1);
      assert.equal(generated, 1);
      connected = true;
      await act(async () => { for (const fn of intervals.values()) fn(); });
      assert.equal(confirmed, 1);
      assert.equal(intervals.size, 0);
      assert.match(document.body.textContent, /Connected! Codex/);
      await act(async () => render(false));
      assert.equal(intervals.size, 0);
    } finally { Object.assign(global, previous); }
  });
});
