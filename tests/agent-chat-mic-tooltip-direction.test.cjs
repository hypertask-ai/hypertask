// HTPR-6292: the Agent Chat composer sits on the viewport's bottom edge, so
// its mic tooltips must open upward (positive CSS bottom) instead of being
// clipped below the fold. Every other mic keeps opening downward.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});

const originalCache = new Map(Object.entries(require.cache));
const stubModule = (filename, exports) => {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};
const stubSourceModule = (relativePath, exports) =>
  stubModule(path.join(root, relativePath), exports);

const tooltipProps = [];
stubSourceModule("src/components/Common/Tooltip.tsx", {
  default: (props) => {
    tooltipProps.push(props);
    return null;
  },
});
stubSourceModule("src/lib/contexts/deviceContext.tsx", {
  useDeviceContext: () => false,
});
stubSourceModule("src/lib/state.tsx", {
  useRecoilValue: () => null,
});
stubSourceModule("src/store/index.ts", {
  currentProjectAtom: {},
});
stubSourceModule("src/utils/undoActions/helperFuncs.ts", {
  cn: (...args) => args.filter(Boolean).join(" "),
});
stubModule(require.resolve("react-hot-toast"), {
  default: { error: () => {} },
});

const { MobileViewContext } = jiti(
  path.join(root, "src/lib/contexts/mobileContext.tsx"),
);
const { AudioButton: RealAudioButton } = jiti(
  path.join(root, "src/components/RTE/Components/AudioButton.tsx"),
);

for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) {
  require.cache[filename] = cachedModule;
}

const renderMic = (id) => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://app.hypertask.ai/" },
  );
  const globalsSnapshot = new Map(
    ["window", "document", "HTMLElement", "Node", "Event", "MouseEvent",
      "IS_REACT_ACT_ENVIRONMENT", "localStorage"].map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(global, key),
    ]),
  );
  const previousGlobals = Object.fromEntries(
    [...globalsSnapshot].map(([key, existed]) => [key, global[key]]),
  );
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    // AudioButton reads the bare `localStorage` global, not window.localStorage.
    localStorage: dom.window.localStorage,
  });

  tooltipProps.length = 0;
  const rootEl = dom.window.document.getElementById("root");
  const reactRoot = createRoot(rootEl);
  act(() => {
    reactRoot.render(
      React.createElement(
        MobileViewContext.Provider,
        { value: false },
        React.createElement(RealAudioButton, {
          id,
          editor: null,
          callbackHandler: () => {},
          toggleRecording: () => {},
          ariaLabel: "Dictate message",
        }),
      ),
    );
  });
  const mic = dom.window.document.getElementById(id);
  assert.ok(mic, "mic element should render");
  // React synthesizes onMouseEnter from delegated mouseover events.
  act(() => {
    mic.dispatchEvent(
      new dom.window.MouseEvent("mouseover", { bubbles: true }),
    );
  });

  const bottoms = tooltipProps.map((props) => props.bottom);
  act(() => {
    reactRoot.unmount();
  });
  Object.assign(global, previousGlobals);
  for (const [key, existed] of globalsSnapshot) {
    if (!existed && Object.prototype.hasOwnProperty.call(global, key)) {
      delete global[key];
    }
  }
  return bottoms;
};

test("agent chat mic tooltips open upward", () => {
  assert.deepEqual(renderMic("agent-chat-audio-button"), [45, 80]);
});

test("other mics keep their downward tooltips", () => {
  assert.deepEqual(renderMic("create-comment-audio-button"), [-45, -80]);
});