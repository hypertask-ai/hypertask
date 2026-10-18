const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  jsx: true,
});

const flagState = { on: true };
const useFlagFile = path.join(root, "src/hooks/useFlag.tsx");
function loadHook() {
  const previous = require.cache[useFlagFile];
  require.cache[useFlagFile] = {
    id: useFlagFile, filename: useFlagFile, loaded: true,
    exports: { useFlag: () => flagState.on, useFlagLoaded: () => true },
  };
  try {
    return jiti(path.join(root, "src/components/PageComponents/TaskDetail/AI Task Writer/useRevealWriterResponse.ts")).useRevealWriterResponse;
  } finally {
    if (previous) require.cache[useFlagFile] = previous;
    else delete require.cache[useFlagFile];
  }
}

async function streamAnswer({ flagOn = true, isMobile = false, responses }) {
  flagState.on = flagOn;
  const useRevealWriterResponse = loadHook();
  const dom = new JSDOM(`<div id="root"></div>`, { url: "https://app.hypertask.ai/detail/project-15/7336" });
  const scrolls = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ id: this.id, options }); };
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { value, configurable: true, writable: true });
  function Writer({ response }) {
    const panelRef = React.useRef(null);
    useRevealWriterResponse(panelRef, Boolean(response), isMobile);
    return React.createElement("div", { id: "popoverIddescription", ref: panelRef }, response || "Thinking...");
  }
  try {
    const reactRoot = createRoot(dom.window.document.getElementById("root"));
    for (const response of responses) {
      await React.act(async () => reactRoot.render(React.createElement(Writer, { response })));
    }
    await React.act(async () => reactRoot.unmount());
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
  return scrolls;
}

const streaming = ["", "", "<h1>Fix MCP", "<h1>Fix MCP tasks count</h1><p>Fix", "<h1>Fix MCP tasks count</h1><p>Fix the route.</p>"];

test("when the AI answer starts streaming, the writer scrolls into view once", async () => {
  const scrolls = await streamAnswer({ responses: streaming });
  assert.deepEqual(scrolls, [{ id: "popoverIddescription", options: { behavior: "smooth", block: "nearest" } }]);
});

test("while the writer is still thinking, the page does not move", async () => {
  const scrolls = await streamAnswer({ responses: ["", ""] });
  assert.deepEqual(scrolls, []);
});

test("a retry that clears and refills the answer reveals the writer again", async () => {
  const scrolls = await streamAnswer({ responses: [...streaming, "", "<p>Second try</p>"] });
  assert.equal(scrolls.length, 2);
});

test("with the bugfix flag off, the writer keeps the old behaviour and never scrolls", async () => {
  const scrolls = await streamAnswer({ flagOn: false, responses: streaming });
  assert.deepEqual(scrolls, []);
});

test("still allowed: the phone writer sheet is left alone", async () => {
  const scrolls = await streamAnswer({ isMobile: true, responses: streaming });
  assert.deepEqual(scrolls, []);
});
