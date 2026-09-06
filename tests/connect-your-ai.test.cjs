const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  cache: false,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});
const {
  CONNECT_PROVIDER_SETUP_URLS,
  CONNECT_PROVIDER_STEPS,
  getOtherChatsCopy,
} = jiti(path.join(root, "src/components/Modals/Settings/connectYourAi.ts"));

const serverUrl = "https://mcp.hypertask.ai/mcp";

// The settings components rely on the classic JSX runtime, so React has to be
// reachable as a global for the whole render, including React's own microtasks.
global.React = React;
global.IS_REACT_ACT_ENVIRONMENT = true;

const stepIndex = (provider, pattern) =>
  CONNECT_PROVIDER_STEPS[provider].findIndex((step) => pattern.test(step));
const stepText = (provider) => CONNECT_PROVIDER_STEPS[provider].join(" | ");

test("each provider journey opens in a new tab and ends at the server link", () => {
  for (const provider of ["claude", "chatgpt"]) {
    assert.match(CONNECT_PROVIDER_STEPS[provider][0], /opens in a new tab/);
    assert.match(
      CONNECT_PROVIDER_STEPS[provider].at(-1),
      /Hypertask server link/,
    );
  }
  assert.match(stepText("claude"), /Connectors/);
  assert.match(stepText("chatgpt"), /Apps and Connectors/);
});

test("ChatGPT tells you to switch on Developer mode before Create", () => {
  // ChatGPT hides the Create control until Developer mode is on, so a person
  // following these steps in order has to reach Developer mode first.
  const developerMode = stepIndex("chatgpt", /Developer mode/);
  const create = stepIndex("chatgpt", /\bCreate\b/);

  assert.ok(developerMode >= 0, "ChatGPT steps must name Developer mode");
  assert.ok(create >= 0, "ChatGPT steps must name the Create control");
  assert.ok(
    developerMode < create,
    "Developer mode has to come before Create, or the Create control is missing",
  );
});

test("the setup links point at each provider's own site", () => {
  assert.equal(
    new URL(CONNECT_PROVIDER_SETUP_URLS.claude).hostname,
    "claude.ai",
  );
  assert.equal(
    new URL(CONNECT_PROVIDER_SETUP_URLS.chatgpt).hostname,
    "chatgpt.com",
  );
});

test("the fallback chat sentence contains the canonical MCP server URL", () => {
  assert.equal(
    getOtherChatsCopy(serverUrl),
    "Connect to Hypertask at https://mcp.hypertask.ai/mcp.",
  );
});

test("/connect opens the Connect-your-AI settings", async () => {
  const nextConfig = require(path.join(root, "next.config.js"));
  const redirects = await nextConfig.redirects();

  assert.deepEqual(
    redirects.find(({ source }) => source === "/connect"),
    {
      source: "/connect",
      destination: "/settings/mcp",
      permanent: false,
    },
  );
});

test("Add to Claude opens Claude before it waits on the clipboard", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/settings/mcp",
  });

  const previous = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
  };

  const opened = [];
  let releaseClipboard;
  const clipboardWrote = [];
  // Hold the clipboard promise open so the assertion below can prove the tab
  // was opened while the click gesture was still live, not after an await.
  const clipboardPending = new Promise((resolve) => {
    releaseClipboard = resolve;
  });

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    // Node ships its own read-only navigator, so plain assignment is ignored.
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: dom.window.navigator,
    });

    dom.window.open = (url, target, features) => {
      opened.push({ url, target, features });
      return null;
    };
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value) => {
          clipboardWrote.push(value);
          return clipboardPending;
        },
      },
    });

    const { createRoot } = require("react-dom/client");
    const { act } = React;
    const connectModule = jiti(
      path.join(root, "src/components/Modals/Settings/ConnectYourAiSection.tsx"),
    );
    const ConnectYourAiSection = connectModule.default ?? connectModule;

    const container = dom.window.document.getElementById("root");
    const reactRoot = createRoot(container);
    await act(async () => {
      reactRoot.render(React.createElement(ConnectYourAiSection));
    });

    const claudeButton = [
      ...container.querySelectorAll("button"),
    ].find((button) => button.textContent.includes("Add to Claude"));
    assert.ok(claudeButton, "the panel must offer an Add to Claude button");

    claudeButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );

    // No await between the click and here: the tab must already be open.
    assert.deepEqual(opened, [
      {
        url: CONNECT_PROVIDER_SETUP_URLS.claude,
        target: "_blank",
        features: "noopener,noreferrer",
      },
    ]);
    assert.deepEqual(clipboardWrote, [serverUrl]);

    releaseClipboard();
    await act(async () => {
      await clipboardPending;
    });
    assert.match(container.textContent, /Link copied/);

    await act(async () => {
      reactRoot.unmount();
    });
  } finally {
    releaseClipboard?.();
    global.window = previous.window;
    global.document = previous.document;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previous.navigator,
    });
    dom.window.close();
  }
});
