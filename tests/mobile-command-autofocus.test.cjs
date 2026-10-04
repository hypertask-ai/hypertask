const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const readSource = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const pullDownCommandHosts = [
  "src/app/inbox/Inbox.tsx",
  "src/app/inbox/agent/AgentInbox.tsx",
  "src/components/PageComponents/Calendar/index.tsx",
];

test("pull-down command hosts retain synchronous keyboard activation", () => {
  for (const relativePath of pullDownCommandHosts) {
    if (relativePath === "src/app/inbox/Inbox.tsx") {
      const source = readSource(relativePath);
      assert.match(source, /const HypertasksCommands = loadedCommands \?\? commands/);
      assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?commandFocusProxy\.current\?\.focus\(\{ preventScroll: true \}\)/);
      assert.match(source, /<input[\s\S]*?ref=\{commandFocusProxy\}[\s\S]*?type="search"[\s\S]*?inputMode="search"/);
      assert.match(source, /focusProxy=\{commandFocusProxy\}/);
      continue;
    }
    const source = readSource(relativePath);

    assert.match(
      source,
      /import HypertasksCommands from ["']@\/components\/commands["'];/,
      `${relativePath} must statically import the palette`,
    );
    assert.doesNotMatch(
      source,
      /dynamic\(\(\) => import\(["']@\/components\/commands["']\)/,
      `${relativePath} must not defer the palette behind a dynamic import`,
    );
  }
});

test("mobile command input focuses only through the synchronous callback ref", () => {
  const source = readSource(
    "src/components/Modals/commands/HTC/commands.tsx",
  );

  assert.match(
    source,
    /if \(!input \|\| \(!isMobile && !focusProxy\)\) return;[\s\S]*?el\.focus\(\{ preventScroll: true \}\);/,
  );
  assert.match(source, /autoFocus=\{!isMobile\}[\s\S]*?id="htc-mobile-search"/);
});

test("mobile command search uses one flush rounded focus ring", () => {
  const commands = readSource(
    "src/components/Modals/commands/HTC/commands.tsx",
  );
  const searchInput = commands.slice(
    commands.indexOf("const searchInput"),
    commands.indexOf("if (isMobile)"),
  );

  assert.match(commands, /useHTC\(allCommands_, emptyQueryCommands, !isMobile\)/);
  assert.match(
    searchInput,
    /className="flex items-center gap-2\.5 rounded-\[4px\] px-4 ring-1 ring-inset ring-hypertasks-purple"/,
  );
  assert.doesNotMatch(searchInput, /\bm-2\b|bg-newcomment-well/);
});

test("mobile commands select no row until the user searches", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://app.hypertask.ai/board",
  });
  const globalNames = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previousGlobals = new Map(
    globalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(global, name),
    ]),
  );
  const statePath = path.join(root, "src/lib/state.tsx");
  const storePath = path.join(root, "src/store/index.ts");
  const userPath = path.join(root, "src/utils/getCurrentUser.ts");
  const hookPath = path.join(root, "src/hooks/MultiPages/HTC/useHTC.tsx");
  const previousModules = new Map(
    [statePath, storePath, userPath, hookPath].map((filename) => [
      filename,
      require.cache[filename],
    ]),
  );
  let reactRoot;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    delete require.cache[hookPath];
    require.cache[statePath] = {
      id: statePath,
      filename: statePath,
      loaded: true,
      exports: {
        useRecoilState: (state) => React.useState(state.default),
      },
    };
    require.cache[storePath] = {
      id: storePath,
      filename: storePath,
      loaded: true,
      exports: {
        currentProjectAtom: { default: null },
        frequentlyUsedHTCAton: { default: {} },
      },
    };
    require.cache[userPath] = {
      id: userPath,
      filename: userPath,
      loaded: true,
      exports: { getCurrentUserFromCookies: () => null },
    };

    const jiti = createJiti(__filename, {
      alias: { "@": path.join(root, "src") },
    });
    const useHTC = jiti(hookPath).default;
    const commandGroups = [{
      group: "Board",
      commandLists: [{
        key: "toggleBoardZoom",
        name: "Zoom board out",
        commandMode: 1,
        keywords: "zoom board",
      }],
    }];

    let onKeyChange;
    const Harness = () => {
      const commands = useHTC(commandGroups, commandGroups, false);
      onKeyChange = commands.onKeyChange;
      return React.createElement("output", {
        "data-selected": commands.selectedCommand?.key ?? "none",
      });
    };

    const container = document.getElementById("root");
    reactRoot = createRoot(container);
    await React.act(async () => {
      reactRoot.render(React.createElement(Harness));
    });
    assert.equal(container.querySelector("output").dataset.selected, "none");

    await React.act(async () => {
      onKeyChange({ target: { value: "zoom" } });
    });
    assert.equal(
      container.querySelector("output").dataset.selected,
      "toggleBoardZoom",
    );

    await React.act(async () => {
      onKeyChange({ target: { value: "" } });
    });
    assert.equal(container.querySelector("output").dataset.selected, "none");
  } finally {
    try {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
    } finally {
      for (const [filename, previous] of previousModules) {
        if (previous === undefined) delete require.cache[filename];
        else require.cache[filename] = previous;
      }
      dom.window.close();
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor === undefined) delete global[name];
        else Object.defineProperty(global, name, descriptor);
      }
    }
  }
});

function sourceCallback(source, startText, endText, hook, bindings) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing ${startText}`);
  const js = require("typescript").transpileModule(source.slice(start, end), {
    compilerOptions: { target: 7 },
  }).outputText;
  let callback;
  new Function(hook, ...Object.keys(bindings), js)(
    (fn) => { callback = fn; return fn; }, ...Object.values(bindings),
  );
  return callback;
}

test("Inbox cold commit focuses its existing proxy synchronously and warm commit leaves focus to the palette", () => {
  const inbox = readSource("src/app/inbox/Inbox.tsx");
  const calls = [];
  const proxy = { value: "old", focus: (options) => { assert.deepEqual(options, { preventScroll: true }); calls.push("focus"); }, blur: () => calls.push("blur") };
  const effect = (show, loaded, active = null) => sourceCallback(
    inbox, "  useLayoutEffect(() => {\n    // iOS needs", "  useEffect(() => {\n    // Fetch the visible split", "useLayoutEffect",
    { showCommands: { show }, HypertasksCommands: loaded, commandFocusProxy: { current: proxy }, document: { activeElement: active } },
  )();
  effect(true, undefined);
  assert.deepEqual(calls, ["focus"], "focus happens before any promise/microtask");
  effect(true, () => null);
  assert.deepEqual(calls, ["focus"], "a warm synchronous mount must not steal focus");
  effect(false, undefined, proxy);
  assert.deepEqual(calls, ["focus", "blur"]);
  assert.equal(proxy.value, "", "closing discards pending input before a later open");
});

test("loaded command input takes proxy text and selection at focus transfer, including characters typed during animation", () => {
  const dom = new JSDOM('<input id="proxy" type="search"><input id="real" type="search">');
  const proxy = dom.window.document.getElementById("proxy");
  const real = dom.window.document.getElementById("real");
  const frames = [], values = [];
  let allowFocus = false;
  const actualFocus = real.focus.bind(real);
  real.focus = () => { if (allowFocus) actualFocus(); };
  proxy.value = "z"; proxy.focus();
  const commands = readSource("src/components/Modals/commands/HTC/commands.tsx");
  const callback = sourceCallback(
    commands, "  const setInputRef = useCallback(", "  useEffect(() => {\n    if (!isMobile)", "useCallback",
    {
      inputRef: { current: null }, isMobile: true, focusProxy: { current: proxy },
      onKeyChangeRef: { current: (event) => values.push(event.target.value) },
      document: dom.window.document, requestAnimationFrame: (fn) => frames.push(fn),
    },
  );
  callback(real);
  assert.equal(dom.window.document.activeElement, proxy, "failed sheet focus retains the active keyboard input");
  proxy.value = "zoom now"; proxy.setSelectionRange(2, 6);
  allowFocus = true; frames.shift()();
  assert.equal(dom.window.document.activeElement, real);
  assert.equal(real.value, "zoom now");
  assert.equal(values.at(-1), "zoom now", "controlled search state receives every buffered character");
  assert.equal(real.selectionStart, 2); assert.equal(real.selectionEnd, 6);
  callback(null);
  for (const frame of frames) frame();
  dom.window.close();
});
