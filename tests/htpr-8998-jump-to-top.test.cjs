const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function load(relativePath, mocks = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name in mocks) return { __esModule: true, ...mocks[name] };
    assert.ok(["react", "react/jsx-runtime"].includes(name), `Unexpected dependency: ${name}`);
    return require(name);
  }, exports);
  return exports;
}

test("htpr-8998 jump to top is a desktop feature held at owner and qa", () => {
  const flag = load("src/lib/flags/definitions/htpr-8998-jump-to-top.ts");
  assert.equal(flag.HTPR_8998_JUMP_TO_TOP_FLAG, "htpr-8998-jump-to-top");
  assert.equal(flag.default.key, "htpr-8998-jump-to-top");
  assert.equal(flag.default.kind, "feature");
  assert.equal(flag.default.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.default.releaseRisk.risk, "new");
});

test("the button stays hidden until the flag is on and the ticket is scrolled", async () => {
  let flagOn = false;
  let scrollTop = 0;
  const focus = [];
  const scrolled = [];
  const listeners = new Set();
  const scrollElement = {
    get scrollTop() { return scrollTop; },
    addEventListener(_type, fn) { listeners.add(fn); },
    removeEventListener(_type, fn) { listeners.delete(fn); },
  };
  const Button = load("src/components/PageComponents/TaskDetail/CommentAndDescription/JumpToTopButton.tsx", {
    "@/hooks/useFlag": { useFlag: (key) => key === "htpr-8998-jump-to-top" && flagOn },
    "@/lib/flags/definitions/htpr-8998-jump-to-top": { HTPR_8998_JUMP_TO_TOP_FLAG: "htpr-8998-jump-to-top" },
    "@/lib/contexts/TaskDetail/TaskProvider": {
      useTaskContext: () => ({
        focusOn: (id, select) => focus.push([id, select]),
        scrollVirtualize: (target) => scrolled.push(target),
        virtualizer: { scrollElement },
      }),
    },
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container" },
    "lucide-react": { ArrowUp: () => React.createElement("svg", { "data-icon": "arrow-up" }) },
    "@/components/Common/Tooltip": {
      default: ({ text, keyCombination }) => React.createElement("span", {
        "data-tooltip": text,
        "data-keys": keyCombination.join(" "),
      }),
    },
  }).default;

  const previous = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-15/8998" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const reactRoot = createRoot(dom.window.document.getElementById("root"));
  const paint = () => React.act(async () => {
    reactRoot.render(React.createElement(Button));
  });
  const button = () => dom.window.document.querySelector("[data-testid='jump-to-top']");

  try {
    scrollTop = 800;
    await paint();
    assert.equal(button(), null, "flag off hides the button even after a long scroll");

    flagOn = true;
    scrollTop = 200;
    await paint();
    assert.equal(button(), null, "the button waits until the ticket moves past 200px");

    scrollTop = 201;
    await React.act(async () => {
      for (const listener of listeners) listener();
    });
    const shown = button();
    assert.ok(shown, "a scrolled ticket shows the button when the flag is on");
    assert.match(shown.className, /\bh-8\b/);
    assert.match(shown.className, /\bw-8\b/);
    assert.match(shown.className, /rounded-\[4px\]/);
    assert.equal(shown.getAttribute("aria-label"), "Jump to top");
    assert.equal(shown.querySelector("[data-tooltip]")?.getAttribute("data-tooltip"), "Jump to top");
    assert.equal(shown.querySelector("[data-tooltip]")?.getAttribute("data-keys"), "G G");
    assert.ok(shown.querySelector("[data-icon='arrow-up']"));

    await React.act(async () => {
      shown.click();
    });
    assert.deepEqual(focus, [["description-container", false]]);
    assert.deepEqual(scrolled, ["description"]);
  } finally {
    await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});
