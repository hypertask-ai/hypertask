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

test("pull-down command hosts load the palette synchronously", () => {
  for (const relativePath of pullDownCommandHosts) {
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
    /if \(!input \|\| !isMobile\) return;[\s\S]*?el\.focus\(\{ preventScroll: true \}\);/,
  );
  assert.match(source, /autoFocus=\{!isMobile\}[\s\S]*?id="htc-mobile-search"/);
});

test("mobile command search uses mobile-only active styling", () => {
  const commands = readSource(
    "src/components/Modals/commands/HTC/commands.tsx",
  );

  assert.match(commands, /useHTC\(allCommands_, emptyQueryCommands, !isMobile\)/);
  assert.match(
    commands,
    /className=\{isMobile[\s\S]*bg-newcomment-well[\s\S]*ring-hypertasks-purple[\s\S]*border-light-black-border-1/,
  );
});

test("mobile commands select no row until the user searches", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://app.hypertask.ai/board",
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;

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
  const reactRoot = createRoot(container);
  try {
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
      await React.act(async () => reactRoot.unmount());
    } finally {
      for (const [filename, previous] of previousModules) {
        if (previous === undefined) delete require.cache[filename];
        else require.cache[filename] = previous;
      }
      dom.window.close();
      delete global.window;
      delete global.document;
      delete global.HTMLElement;
      delete global.IS_REACT_ACT_ENVIRONMENT;
    }
  }
});
