const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { createRefactoredModuleRequire } = require("./refactored-module-require.cjs");

const root = path.resolve(__dirname, "..");
const sharpPlusFlag = "htpr-7047-sharp-plus-signs";
const keys = {
  HTPR_6902_N_QUICK_ADD_FLAG: "htpr-6902-n-quick-add",
  HTPR_6914_SHIFT_C_QUICK_ADD_FLAG: "htpr-6914-shift-c-quick-add",
  HTPR_7047_SHARP_PLUS_SIGNS_FLAG: sharpPlusFlag,
};

function loadButton(enabled) {
  return createRefactoredModuleRequire(root, {
    react: { ...React, default: React, __esModule: true },
    "@/components/Common/Tooltip": { default: () => null, __esModule: true },
    "@/hooks/useFlag": { useFlag: (key) => enabled.has(key) },
    "@/lib/flags/keys": keys,
  })("./src/components/PageComponents/Kanban/KanbanSectionComponents/NewTaskButton.tsx").default;
}

test("sharp plus is registered as an Everyone-default bugfix", async () => {
  const load = createRefactoredModuleRequire(root, {});
  const keys = load("./src/lib/flags/keys.ts");
  const agentModel = { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: "agent-chat-stop-and-timeout" };
  const definitions = createRefactoredModuleRequire(root, {
    "@/lib/flags/keys": keys,
    "@/lib/agentRuns/model": agentModel,
  })("./src/lib/flags/definitions.ts");
  const flags = createRefactoredModuleRequire(root, {
    "@/lib/flags/keys": keys,
    "@/lib/flags/definitions": definitions,
    "@/lib/prisma": { __esModule: true, default: { featureFlag: { findMany: async () => [] } } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
    "@/lib/agentRuns/model": { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: "agent-chat-stop-and-timeout" },
  })("./src/lib/flags.ts");
  assert.equal(flags.defaultFeatureFlagMode(sharpPlusFlag), "EVERYONE");
  const entry = (await flags.listFeatureFlagModes()).find(({ key }) => key === sharpPlusFlag);
  assert.equal(entry.kind, "bugfix");
  assert.equal(entry.mode, "EVERYONE");
});

const payload = (position) => ({ sectionId: 42, sectionTitle: "Todo", position });
const props = (position, createTaskAt = () => {}) => ({ buttonPosition: position, sectionPayload: payload(position), createTaskAt });

for (const [position, size] of [["top", 10], ["bottom", 14]]) {
  test(`${position} plus keeps its size with pixel-aligned strokes in every theme`, () => {
    const Button = loadButton(new Set([sharpPlusFlag]));
    const dom = new JSDOM(renderToStaticMarkup(React.createElement(Button, props(position))));
    try {
      const svg = dom.window.document.querySelector("svg");
      assert.equal(svg.getAttribute("width"), String(size));
      assert.equal(svg.getAttribute("height"), String(size));
      const viewBoxWidth = Number(svg.getAttribute("viewBox").split(" ")[2]);
      assert.equal(Number(svg.getAttribute("stroke-width")) * size / viewBoxWidth, 2);
      assert.equal(svg.getAttribute("shape-rendering"), "crispEdges");
      assert.equal(svg.querySelectorAll("path").length, 2, "reuse the actual Lucide Plus");
      for (const theme of ["porcelain", "graphite", "amoled", "dia"]) {
        const css = fs.readFileSync(path.join(root, `src/styles/tailwindThemes/${theme}.css`), "utf8");
        dom.window.document.documentElement.className = theme;
        require("postcss").parse(css).walkDecls("stroke-width", (declaration) => {
          assert.equal(svg.matches(declaration.parent.selector), false, `${theme} must not override the pixel stroke`);
        });
      }
    } finally { dom.window.close(); }
  });
}

test("flag off preserves the original icon rendering", () => {
  const Button = loadButton(new Set());
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(Button, props("top"))));
  try {
    const svg = dom.window.document.querySelector("svg");
    assert.equal(svg.getAttribute("stroke-width"), "1.75");
    assert.equal(svg.hasAttribute("shape-rendering"), false);
    assert.equal(svg.classList.contains("keep-stroke"), false);
  } finally { dom.window.close(); }
});

test("top and bottom clicks retain task position, section and quick-entry behavior", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const names = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) Object.defineProperty(global, name, {
    configurable: true, writable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
  });
  const reactRoot = createRoot(document.getElementById("root"));
  try {
    for (const sharp of [false, true]) for (const quick of [false, true]) {
      const enabled = new Set([...(sharp ? [sharpPlusFlag] : []), ...(quick ? ["htpr-6175-quick-entry-cards"] : [])]);
      const Button = loadButton(enabled);
      for (const position of ["top", "bottom"]) {
        const calls = [];
        await React.act(async () => reactRoot.render(React.createElement(Button, props(position, (...args) => calls.push(args)))));
        await React.act(async () => document.querySelector("svg").parentElement.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
        assert.deepEqual(calls, [[position, payload(position), undefined, quick ? true : undefined]]);
      }
      await React.act(async () => reactRoot.render(React.createElement(Button, { ...props("bottom"), snapshot: { isDraggingOver: true } })));
      assert.equal(document.querySelector("svg"), null, "bottom button stays hidden while dragging over the column");
    }
  } finally {
    await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
});
