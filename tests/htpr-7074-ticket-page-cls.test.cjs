const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function loadHook(mocks) {
  const js = ts.transpileModule(read("src/hooks/Task Detail/useThreadSettled.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)((name) => {
    if (name === "react") return React;
    assert.ok(name in mocks, `Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);
  return exports.useThreadSettled;
}

function settledOnFirstRender({ ready, on, applies = true, hydrated = false }) {
  const useThreadSettled = loadHook({
    "@/hooks/useFlag": { useFlag: () => on, useFlagReady: () => ready },
    "@/hooks/General/useHydrated": { useHydrated: () => hydrated },
    "@/lib/flags/keys": { HTPR_7074_TICKET_PAGE_CLS_FLAG: "htpr-7074-ticket-page-cls" },
  });
  const Probe = () => React.createElement("i", { "data-settled": String(useThreadSettled(500, 3, applies)) });
  return renderToString(React.createElement(Probe)).includes('data-settled="true"');
}

test("the comment box is held back until the flag is known and On, and never when the fix does not apply", () => {
  assert.equal(settledOnFirstRender({ ready: false, on: false }), false, "unknown flag: wait, do not paint the box early");
  assert.equal(settledOnFirstRender({ ready: true, on: true }), false, "flag On: wait for the thread to stop growing");
  assert.equal(settledOnFirstRender({ ready: true, on: false }), true, "flag Off: today's behaviour");
  assert.equal(settledOnFirstRender({ ready: false, on: false, applies: false }), true, "cached layout and phone-embedded keep their own path");
});

test("the comment box shows after 2000 ms even if no rows ever appear or the height never settles", async (t) => {
  const { JSDOM } = require("jsdom");
  const { act } = React;
  const dom = new JSDOM("<div id=root></div>");
  const previous = { window: global.window, document: global.document, raf: global.requestAnimationFrame, caf: global.cancelAnimationFrame, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // Frames never fire: the height "keeps changing", or no row ever exists.
  global.requestAnimationFrame = () => 1;
  global.cancelAnimationFrame = () => {};
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const useThreadSettled = loadHook({
      "@/hooks/useFlag": { useFlag: () => true, useFlagReady: () => true },
      "@/hooks/General/useHydrated": { useHydrated: () => true },
      "@/lib/flags/keys": { HTPR_7074_TICKET_PAGE_CLS_FLAG: "htpr-7074-ticket-page-cls" },
    });
    const seen = [];
    const Probe = () => { seen.push(useThreadSettled(500, 0, true)); return null; };
    const { createRoot } = require("react-dom/client");
    const root = createRoot(dom.window.document.getElementById("root"));
    await act(async () => { root.render(React.createElement(Probe)); });
    assert.equal(seen.at(-1), false, "held back at first");
    await act(async () => { t.mock.timers.tick(1999); });
    assert.equal(seen.at(-1), false, "still held just before the limit");
    await act(async () => { t.mock.timers.tick(1); });
    assert.equal(seen.at(-1), true, "shown at the limit");
    await act(async () => { root.unmount(); });
  } finally {
    t.mock.timers.reset();
    Object.assign(global, { window: previous.window, document: previous.document, requestAnimationFrame: previous.raf, cancelAnimationFrame: previous.caf, IS_REACT_ACT_ENVIRONMENT: previous.act });
  }
});

test("both comment box mounts stay in place but hidden until the thread settles", () => {
  assert.match(read("src/components/PageComponents/TaskDetail/CommentAndDescription/index.tsx"), /!cachedLayout && !_mbl && secondaryPanelsReady !== false && \(\s*(\/\/[^\n]*\n\s*)?<SettledComposerSlot settled=\{threadSettled\}>/);
  assert.match(read("src/app/detail/[...slug]/TaskDetailPanels.tsx"), /_mbl && !embedded && secondaryPanelsReady !== false && <SettledComposerSlot settled=\{threadSettled\}>/);
});

test("the hold hides, blocks and removes itself, and adds nothing when settled", () => {
  const slot = read("src/components/PageComponents/TaskDetail/CommentAndDescription/SettledComposerSlot.tsx");
  assert.match(slot, /settled \? \{\} : \{ inert: true, "aria-hidden": true/);
  assert.match(slot, /visibility: "hidden"/);
  assert.match(slot, /display: "contents"/);
});

test("the CLS fix is a registered bugfix flag", () => {
  const definition = read("src/lib/flags/definitions/htpr-7074-ticket-page-cls.ts");
  assert.match(definition, /export const HTPR_7074_TICKET_PAGE_CLS_FLAG = "htpr-7074-ticket-page-cls"/);
  assert.match(definition, /kind: "bugfix"/);
});
