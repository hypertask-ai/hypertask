const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { JSDOM } = require("jsdom");
const { load } = require("./helpers/agent-connection.cjs");
const FLAG = "htpr-7026-agent-connect-check";

function loadScreen(enabled = true) {
  return load("src/components/PageComponents/Onboarding/Screens/ConnectAIOnboardingScreen.tsx", {
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, FLAG); return enabled; } },
    "@/lib/flags/keys": { HTPR_7026_AGENT_CONNECT_CHECK_FLAG: FLAG },
    "@/components/Modals/CliInstall/constants": { INSTALL_COMMAND: "install fixture", LOGIN_COMMAND: "hypertask login" },
    "@/components/Modals/McpToken/components": {
      getIntegrationChipClassName: () => "text-meta",
      ConnectInstructions: ({ integrationId }) => React.createElement("div", null, `Shared config for ${integrationId}`),
      TokenStatusBar: () => null,
    },
    "@/components/Modals/McpToken/components/ConnectInstructions": { CopyableCodeBlock: ({ value }) => React.createElement("pre", null, value) },
    "@/components/Modals/McpToken/hooks/useMcpToken": { useMcpToken: () => ({ token: null, isLoading: true, isGenerating: false, generateToken() {} }) },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "../GetStartedButton": { GetStartedButton: ({ text }) => React.createElement("button", null, text) },
  }).ConnectAIOnboardingScreen;
}

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

test("compact shared picker is terminal-first, reuses CLI and MCP config, and keeps the old onboarding when flag off", async () => {
  await withDOM(async ({ container, reactRoot, act, dom }) => {
    global.fetch = async () => ({ ok: true, json: async () => ({ connected: false }) });
    const Screen = loadScreen();
    await act(async () => reactRoot.render(React.createElement(Screen, { compact: true, visible: false, onNextScreen() {} })));
    const buttons = [...container.querySelectorAll("button")];
    assert.deepEqual(buttons.slice(0, 3).map((button) => button.textContent), ["Claude Code", "Cursor", "Codex"]);
    assert.deepEqual(buttons.map((button) => button.textContent), ["Claude Code", "Cursor", "Codex", "Claude (desktop / web)", "ChatGPT", "VS Code"]);
    assert.match(container.textContent, /Waiting for your agent\.\.\./);
    await act(async () => buttons[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.match(container.textContent, /hypertask login/);
    const mcp = [...container.querySelectorAll("button")].find((button) => button.textContent === "MCP");
    await act(async () => mcp.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.match(container.textContent, /Shared config for claude-code/);
    const Off = loadScreen(false);
    await act(async () => reactRoot.render(React.createElement(Off, { compact: true, onNextScreen() {} })));
    assert.match(container.textContent, /Which AI will you drive Hypertask with/);
    assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent.includes("Hypertask AI, built in")));
    assert.doesNotMatch(container.textContent, /Waiting for your agent/);
  });
});

test("shared confirmation uses the selected tool with flag off and the resolved client only with flag on", async () => {
  for (const enabled of [false, true]) {
    await withDOM(async ({ container, reactRoot, act, dom }) => {
      global.fetch = async (url) => {
        if (url.startsWith("/api/users/ai-connection-status")) {
          assert.match(url, /\?since=/);
        }
        return { ok: true, json: async () => ({ connected: true, client: "Cursor" }) };
      };
      const Screen = loadScreen(enabled);
      await act(async () => reactRoot.render(React.createElement(Screen, { onNextScreen() {} })));
      const tool = [...container.querySelectorAll("button")].find((button) => button.textContent === "Claude Code");
      await act(async () => tool.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
      assert.equal(container.querySelector('[role="status"]').textContent, `Connected! ${enabled ? "Cursor" : "Claude Code"} just talked to Hypertask.`);
    });
  }
});

test("live check polls every four seconds only while visible, uses returned client, and stops at connected", async () => {
  await withDOM(async ({ container, reactRoot, act }) => {
    const intervals = new Map();
    const cleared = [];
    let next = 0;
    let requests = 0;
    let connected = false;
    global.setInterval = (fn, ms) => { assert.equal(ms, 4000); const id = ++next; intervals.set(id, fn); return id; };
    global.clearInterval = (id) => { cleared.push(id); intervals.delete(id); };
    global.fetch = async (url) => { assert.equal(url, "/api/users/ai-connection-status?mode=first"); requests++; return { ok: true, json: async () => ({ connected, client: "Cursor" }) }; };
    const Screen = loadScreen();
    const render = (visible) => reactRoot.render(React.createElement(Screen, { compact: true, visible, onNextScreen() {} }));
    await act(async () => render(false));
    assert.equal(requests, 0);
    assert.equal(intervals.size, 0);
    await act(async () => render(true));
    assert.equal(requests, 1);
    assert.equal(intervals.size, 1);
    await act(async () => { for (const fn of intervals.values()) fn(); });
    assert.equal(requests, 2);
    await act(async () => render(false));
    assert.equal(intervals.size, 0);
    await act(async () => render(true));
    connected = true;
    await act(async () => { for (const fn of intervals.values()) fn(); });
    assert.match(container.textContent, /Connected! Cursor just talked to Hypertask\./);
    assert.match(container.textContent, /Ask your agent to pick up the top task/);
    assert.equal(intervals.size, 0);
    assert.ok(cleared.length >= 2);
  });
});

test("armed signup renders compact instructions and resolves the connected client with session flag off", async () => {
  await withDOM(async ({ container, reactRoot, act }) => {
    let connected = false;
    const intervals = new Map();
    global.setInterval = (fn) => { intervals.set(1, fn); return 1; };
    global.clearInterval = (id) => intervals.delete(id);
    global.fetch = async (url) => {
      assert.equal(url, "/api/users/ai-connection-status?mode=first");
      return { ok: true, json: async () => ({ eligible: true, connected, client: "Codex" }) };
    };
    const Screen = loadScreen(false);
    await act(async () => reactRoot.render(React.createElement(Screen, { compact: true, serverEligible: true, onNextScreen() {} })));
    assert.match(container.textContent, /Waiting for your agent/);
    assert.doesNotMatch(container.textContent, /Which AI will you drive/);
    assert.deepEqual([...container.querySelectorAll("button")].slice(0, 3).map((button) => button.textContent), ["Claude Code", "Cursor", "Codex"]);
    connected = true;
    await act(async () => { for (const fn of intervals.values()) fn(); });
    assert.match(container.textContent, /Connected! Codex just talked to Hypertask/);
    assert.match(container.textContent, /Ask your agent to pick up the top task/);
    assert.equal(intervals.size, 0);
  });
});

test("board card honors server eligibility with flag off, existing connection, dismissal and board scope", async () => {
  for (const [enabled, state, expected] of [
    [false, { eligible: false, boardId: 7 }, false],
    [false, { eligible: true, connected: false, dismissed: false, boardId: 7 }, true],
    [false, { eligible: true, connected: true, boardId: 7 }, false],
    [false, { eligible: true, dismissed: true, boardId: 7 }, false],
    [false, { eligible: true, boardId: 8 }, false],
    [true, { connected: true, boardId: 7 }, false],
    [true, { dismissed: true, boardId: 7 }, false],
    [true, { boardId: 8 }, false],
    [true, { connected: false, dismissed: false, boardId: 7 }, true],
  ]) {
    await withDOM(async ({ container, reactRoot, act, dom }) => {
      const requests = [];
      global.fetch = async (url, options) => { requests.push({ url, method: options?.method }); return { ok: true, json: async () => state }; };
      global.IntersectionObserver = class { observe() {} disconnect() {} };
      const { AgentConnectCard } = load("src/components/PageComponents/Onboarding/AgentConnectCard.tsx", {
        "@/hooks/useFlag": { useFlag: () => enabled },
        "@/lib/flags/keys": { HTPR_7026_AGENT_CONNECT_CHECK_FLAG: FLAG },
        "next/dynamic": () => (props) => { assert.equal(props.compact, true); assert.equal(props.serverEligible, state.eligible === true); return React.createElement("div", null, "Shared connection screen"); },
      });
      await act(async () => reactRoot.render(React.createElement(AgentConnectCard, { projectId: 7, userId: 42 })));
      assert.equal(!!container.querySelector("section"), expected);
      assert.equal(requests.length, 1);
      if (expected) {
        assert.match(container.textContent, /Shared connection screen/);
        const dismiss = container.querySelector("button");
        await act(async () => dismiss.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
        assert.equal(requests.at(-1).method, "POST");
        assert.equal(container.querySelector("section"), null);
      }
    });
  }
});

test("board card clears armed eligibility when user or board changes and ignores aborted responses", async () => {
  await withDOM(async ({ container, reactRoot, act }) => {
    const pending = [];
    global.fetch = async (url, options) => new Promise((resolve) => pending.push({ resolve, signal: options.signal }));
    global.IntersectionObserver = class { observe() {} disconnect() {} };
    const { AgentConnectCard } = load("src/components/PageComponents/Onboarding/AgentConnectCard.tsx", {
      "@/hooks/useFlag": { useFlag: () => false },
      "@/lib/flags/keys": { HTPR_7026_AGENT_CONNECT_CHECK_FLAG: FLAG },
      "next/dynamic": () => () => React.createElement("div", null, "Shared connection screen"),
    });
    const render = (userId, projectId) => reactRoot.render(React.createElement(AgentConnectCard, { userId, projectId }));
    const respond = (request, state) => request.resolve({ ok: true, json: async () => state });
    await act(async () => render(42, 7));
    await act(async () => respond(pending[0], { eligible: true, boardId: 7 }));
    assert.ok(container.querySelector("section"));
    await act(async () => render(99, 7));
    assert.equal(container.querySelector("section"), null);
    assert.equal(pending[0].signal.aborted, true);
    await act(async () => render(99, 8));
    await act(async () => respond(pending[1], { eligible: true, boardId: 7 }));
    assert.equal(container.querySelector("section"), null);
    await act(async () => respond(pending[2], { eligible: false, boardId: 8 }));
    assert.equal(container.querySelector("section"), null);
  });
});

test("connected email shares the current layout, escapes the client and has exactly one absolute board CTA", () => {
  const { load } = require("./helpers/agent-connection.cjs");
  const { renderAgentConnectedEmail } = load("src/utils/controllers/notifications/emailTemplates.ts", {
    "@/utils/htmlEscape": { escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") },
    "./commentPreview": { commentPreview: () => "" },
    "./mentionText": { mentionQuoteHtml: () => "" },
  });
  const email = renderAgentConnectedEmail("Claude Code <fixture>", 7);
  assert.equal(email.subject, "Your agent is connected");
  const dom = new JSDOM(email.html);
  const ctas = [...dom.window.document.querySelectorAll("a.cta")];
  assert.equal(ctas.length, 1);
  assert.equal(ctas[0].href, "https://app.hypertask.ai/project?id=7");
  assert.equal(ctas[0].textContent, "Open your board");
  assert.match(email.html, /Claude Code &lt;fixture&gt;/);
  assert.match(dom.window.document.body.textContent, /Ask your agent to pick up the top task on your board/);
  assert.ok(dom.window.document.querySelector(".email-card"));
  assert.doesNotMatch(email.html, /\u2014/);
  dom.window.close();
});
