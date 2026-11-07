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

const renderMic = (id, props) => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://app.hypertask.ai/" },
  );
  const keys = ["window", "document", "HTMLElement", "Node", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT", "localStorage"];
  const existed = new Map(keys.map((key) => [key, Object.prototype.hasOwnProperty.call(global, key)]));
  const previous = Object.fromEntries(keys.map((key) => [key, global[key]]));
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: dom.window.localStorage,
  });
  const reactRoot = createRoot(dom.window.document.getElementById("root"));
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
          ariaLabel: "Start dictation",
          ...props,
        }),
      ),
    );
  });
  const className = dom.window.document.getElementById(id).className;
  act(() => {
    reactRoot.unmount();
  });
  Object.assign(global, previous);
  for (const [key, had] of existed) {
    if (!had && Object.prototype.hasOwnProperty.call(global, key)) delete global[key];
  }
  return className;
};

test("HTPR-8829 Ctrl+J primary mic fills white-black, not the theme primary", () => {
  const className = renderMic("compose-task-audio-button", { compactListeningPill: true, primaryMic: true });
  assert.match(className, /(^| )bg-white-black( |$)/);
  assert.match(className, /(^| )text-white-black-inverted( |$)/);
  assert.doesNotMatch(className, /bg-shadcn-primary/);
});

test("HTPR-8829 the AI chat mic keeps the theme primary fill", () => {
  const className = renderMic("ai-chat-audio-button-1", { compactListeningPill: true });
  assert.match(className, /(^| )bg-shadcn-primary( |$)/);
  assert.doesNotMatch(className, /bg-white-black/);
});
