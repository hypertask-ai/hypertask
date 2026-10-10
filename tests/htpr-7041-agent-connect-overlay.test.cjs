const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { JSDOM } = require("jsdom");
const { load } = require("./helpers/agent-connection.cjs");

const OVERLAY_FLAG = "htpr-7041-agent-connect-overlay";
const CARD_FLAG = "htpr-7026-agent-connect-check";
const keys = { HTPR_7026_AGENT_CONNECT_CHECK_FLAG: CARD_FLAG, HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG: OVERLAY_FLAG };

async function withDOM(fn) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://fixture.test/project?id=7", pretendToBeVisual: true });
  const previous = { window: global.window, document: global.document, IntersectionObserver: global.IntersectionObserver, fetch: global.fetch, setInterval: global.setInterval, clearInterval: global.clearInterval, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require("react-dom/client");
  const container = dom.window.document.getElementById("root");
  const reactRoot = createRoot(container);
  try { await fn({ dom, container, reactRoot, act: React.act }); }
  finally {
    await React.act(async () => reactRoot.unmount());
    Object.assign(global, previous);
    dom.window.close();
  }
}

const flagMock = (flags) => ({ useFlag: (key) => flags[key] === true });
const modalStub = () => (props) => React.createElement(
  "div",
  { "data-testid": "modal" },
  React.createElement("button", { id: "close", onClick: props.closeHandler }, "Close"),
  props.waitingForAgent ? "waiting-line" : "plain",
);

test("block above the board is hidden with the flag on and shown with it off", async () => {
  for (const [overlayOn, expected] of [[true, false], [false, true]]) {
    await withDOM(async ({ container, reactRoot, act }) => {
      global.fetch = async () => ({ ok: true, json: async () => ({ eligible: true, connected: false, dismissed: false, boardId: 7 }) });
      global.IntersectionObserver = class { observe() {} disconnect() {} };
      const { AgentConnectCard } = load("src/components/PageComponents/Onboarding/AgentConnectCard.tsx", {
        "@/hooks/useFlag": flagMock({ [OVERLAY_FLAG]: overlayOn, [CARD_FLAG]: true }),
        "@/lib/flags/keys": keys,
        "./AgentConnectOverlay": { AgentConnectOverlay: () => React.createElement("div", { "data-testid": "overlay" }) },
        "next/dynamic": () => () => React.createElement("div", null, "Shared connection screen"),
      });
      await act(async () => reactRoot.render(React.createElement(AgentConnectCard, { projectId: 7, userId: 42 })));
      assert.equal(!!container.querySelector("section"), expected);
      assert.equal(!!container.querySelector('[data-testid="overlay"]'), !expected);
    });
  }
});

function loadOverlay(flags) {
  return load("src/components/PageComponents/Onboarding/AgentConnectOverlay.tsx", {
    "@/hooks/useFlag": flagMock(flags),
    "@/lib/flags/keys": keys,
    "next/dynamic": modalStub,
  }).AgentConnectOverlay;
}

test("dialog opens by itself only for a never-connected user on their first board, with the flag on", async () => {
  for (const [overlayOn, state, expected] of [
    [true, { connected: false, dismissed: false, boardId: 7 }, true],
    [true, { connected: true, dismissed: false, boardId: 7 }, false],
    [true, { connected: false, dismissed: true, boardId: 7 }, false],
    [true, { connected: false, dismissed: false, boardId: 8 }, false],
    [false, { connected: false, dismissed: false, boardId: 7 }, false],
  ]) {
    await withDOM(async ({ container, reactRoot, act }) => {
      const requests = [];
      global.fetch = async (url, options) => { requests.push({ url, method: options?.method }); return { ok: true, json: async () => state }; };
      const Overlay = loadOverlay({ [OVERLAY_FLAG]: overlayOn });
      await act(async () => reactRoot.render(React.createElement(Overlay, { projectId: 7, userId: 42 })));
      assert.equal(!!container.querySelector('[data-testid="modal"]'), expected, JSON.stringify(state));
      if (overlayOn) assert.equal(requests[0].url, "/api/users/ai-connection-status?mode=first");
      else assert.equal(requests.length, 0);
      if (expected) assert.match(container.textContent, /waiting-line/);
    });
  }
});

test("closing posts the dismissal once and a reload with the stored dismissal does not reopen it", async () => {
  await withDOM(async ({ container, reactRoot, act, dom }) => {
    let dismissed = false;
    const posts = [];
    global.fetch = async (url, options) => {
      if (options?.method === "POST") { posts.push(url); dismissed = true; return { ok: true, json: async () => ({ success: true }) }; }
      return { ok: true, json: async () => ({ connected: false, dismissed, boardId: 7 }) };
    };
    const Overlay = loadOverlay({ [OVERLAY_FLAG]: true });
    const render = () => reactRoot.render(React.createElement(Overlay, { projectId: 7, userId: 42 }));
    await act(async () => render());
    assert.ok(container.querySelector('[data-testid="modal"]'));
    await act(async () => container.querySelector("#close").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.deepEqual(posts, ["/api/users/ai-connection-status"]);
    assert.equal(container.querySelector('[data-testid="modal"]'), null);
    // Reload: a fresh mount reads the stored dismissal.
    await act(async () => reactRoot.render(null));
    await act(async () => render());
    assert.equal(container.querySelector('[data-testid="modal"]'), null);
  });
});

test("waiting line says Waiting for your agent... then Connected! and stops polling", async () => {
  await withDOM(async ({ container, reactRoot, act }) => {
    const intervals = new Map();
    let next = 0;
    let connected = false;
    global.setInterval = (fn, ms) => { assert.equal(ms, 4000); intervals.set(++next, fn); return next; };
    global.clearInterval = (id) => intervals.delete(id);
    global.fetch = async (url) => { assert.equal(url, "/api/users/ai-connection-status?mode=first"); return { ok: true, json: async () => ({ connected }) }; };
    const { AgentWaitingLine } = load("src/components/Modals/McpToken/components/AgentWaitingLine.tsx", {
      "@/hooks/useFlag": flagMock({ [OVERLAY_FLAG]: true }),
      "@/lib/flags/keys": keys,
      "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    });
    await act(async () => reactRoot.render(React.createElement(AgentWaitingLine)));
    assert.equal(container.querySelector('[role="status"]').textContent, "Waiting for your agent...");
    connected = true;
    await act(async () => { for (const fn of [...intervals.values()]) fn(); });
    assert.equal(container.querySelector('[role="status"]').textContent, "Connected!");
    assert.equal(intervals.size, 0);
  });
});

test("server: card state and dismissal also work for the overlay flag; the email flag stays separate", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const lib = fs.readFileSync(path.join(root, "src/lib/onboarding/agentConnection.ts"), "utf8");
  const route = fs.readFileSync(path.join(root, "src/app/api/users/ai-connection-status/route.ts"), "utf8");
  assert.match(lib, /isFeatureEnabled\(HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG, userId\)/);
  assert.match(lib, /const eligible = await isAgentConnectStateEnabledFor\(userId\)/);
  assert.match(lib, /if \(!\(await isAgentConnectCheckEnabledFor\(userId\)\)\) return;/, "email stays on the 7026 flag");
  assert.match(route, /POST[\s\S]*isAgentConnectStateEnabledFor\(user\.id\)/);
});

test("auto-opened dialog takes focus so Escape closes it without a click first", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../src/components/Modals/McpToken/McpTokenModal.tsx"), "utf8");
  assert.match(src, /autoFocus=\{waitingForAgent && overlayFlagOn\}/);
  assert.match(src, /toggle=\{closeHandler\}/, "Escape (reactstrap keyboard) calls the same handler as Close");
});
