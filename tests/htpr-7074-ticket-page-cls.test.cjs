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

const mocksFor = (ready, on, hydrated) => ({
  "@/hooks/useFlag": { useFlag: () => on, useFlagReady: () => ready },
  "@/hooks/General/useHydrated": { useHydrated: () => hydrated },
  "@/lib/flags/keys": { HTPR_7074_TICKET_PAGE_CLS_FLAG: "htpr-7074-ticket-page-cls" },
});

function settledOnFirstRender({ ready, on, applies = true, hydrated = false }) {
  const useThreadSettled = loadHook(mocksFor(ready, on, hydrated));
  const Probe = () => React.createElement("i", { "data-settled": String(useThreadSettled(applies).settled) });
  return renderToString(React.createElement(Probe)).includes('data-settled="true"');
}

test("the comment box is held back until the flag is known and On, and never when the fix does not apply", () => {
  assert.equal(settledOnFirstRender({ ready: false, on: false }), false, "unknown flag: wait, do not paint the box early");
  assert.equal(settledOnFirstRender({ ready: true, on: true }), false, "flag On: wait for the box to stop moving");
  assert.equal(settledOnFirstRender({ ready: true, on: false }), true, "flag Off: today's behaviour, immediate");
  assert.equal(settledOnFirstRender({ ready: false, on: false, applies: false }), true, "cached layout and phone-embedded keep their own path");
});

// Mounts the hook with a slot whose box top the test controls; frames and timers are driven by hand.
async function withHarness(t, { hydrated = true, boxTop }, run) {
  const { JSDOM } = require("jsdom");
  const { act } = React;
  const dom = new JSDOM("<div id=root></div>");
  const previous = { window: global.window, document: global.document, raf: global.requestAnimationFrame, caf: global.cancelAnimationFrame, act: global.IS_REACT_ACT_ENVIRONMENT, style: global.getComputedStyle };
  global.window = dom.window;
  global.document = dom.window.document;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let callback = null;
  global.requestAnimationFrame = (fn) => { callback = fn; return 1; };
  global.cancelAnimationFrame = () => { callback = null; };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const useThreadSettled = loadHook(mocksFor(true, true, hydrated));
    const seen = [];
    const Probe = () => {
      const { settled, slotRef } = useThreadSettled(true);
      seen.push(settled);
      return React.createElement("div", { ref: slotRef }, React.createElement("section", { id: "box" }));
    };
    const { createRoot } = require("react-dom/client");
    const rootNode = createRoot(dom.window.document.getElementById("root"));
    await act(async () => { rootNode.render(React.createElement(Probe)); });
    dom.window.document.getElementById("box").getBoundingClientRect = () => ({ top: boxTop.current });
    const commentHeight = { current: 40 };
    const comment = dom.window.document.createElement("div");
    comment.setAttribute("data-testid", "ticket-comment");
    comment.getBoundingClientRect = () => ({ top: 0, height: commentHeight.current });
    dom.window.document.body.appendChild(comment);
    let clock = 0;
    const frame = async (advance) => {
      clock += advance;
      const fn = callback;
      callback = null;
      if (fn) await act(async () => { fn(clock); });
    };
    await run({ seen, boxTop, commentHeight, frame, tick: (ms) => act(async () => { t.mock.timers.tick(ms); }) });
    await act(async () => { rootNode.unmount(); });
  } finally {
    t.mock.timers.reset();
    Object.assign(global, { window: previous.window, document: previous.document, requestAnimationFrame: previous.raf, cancelAnimationFrame: previous.caf, IS_REACT_ACT_ENVIRONMENT: previous.act, getComputedStyle: previous.style });
  }
}

test("the comment box shows once its own top has held still for 300 ms, and a move restarts the wait", async (t) => {
  await withHarness(t, { boxTop: { current: 400 } }, async ({ seen, boxTop, frame }) => {
    await frame(0);
    for (let i = 0; i < 15; i += 1) await frame(16);
    assert.equal(seen.at(-1), false, "250 ms still is not enough");
    boxTop.current = 500;
    await frame(16);
    for (let i = 0; i < 15; i += 1) await frame(16);
    assert.equal(seen.at(-1), false, "a move of 100 px restarted the wait");
    boxTop.current = 500.8;
    for (let i = 0; i < 8; i += 1) await frame(16);
    assert.equal(seen.at(-1), true, "300 ms without a move of more than 1 px: shown");
  });
});

test("a busy page (one late frame) restarts the wait, because the box may have moved unseen between the frames", async (t) => {
  await withHarness(t, { boxTop: { current: 400 } }, async ({ seen, frame }) => {
    await frame(0);
    await frame(16);
    await frame(900);
    assert.equal(seen.at(-1), false, "a 900 ms gap between frames is not 300 ms of stillness");
    for (let i = 0; i < 25; i += 1) await frame(16);
    assert.equal(seen.at(-1), true);
  });
});

test("the comment box shows 5000 ms after its slot mounted when the top never stops moving, and the cap is not restarted", async (t) => {
  await withHarness(t, { boxTop: { current: 0 } }, async ({ seen, boxTop, frame, tick }) => {
    for (let i = 0; i < 10; i += 1) { boxTop.current += 50; await frame(16); }
    await tick(2500);
    boxTop.current += 50;
    await frame(16);
    await tick(2499);
    assert.equal(seen.at(-1), false, "still held just before the limit");
    await tick(1);
    assert.equal(seen.at(-1), true, "shown at 5000 ms");
  });
});

test("a still box is not revealed before the page is hydrated, only by the cap", async (t) => {
  await withHarness(t, { hydrated: false, boxTop: { current: 400 } }, async ({ seen, frame, tick }) => {
    await frame(0);
    for (let i = 0; i < 100; i += 1) await frame(16);
    assert.equal(seen.at(-1), false);
    await tick(5000);
    assert.equal(seen.at(-1), true);
  });
});

test("both comment box mounts stay in place but hidden until the box settles", () => {
  assert.match(read("src/components/PageComponents/TaskDetail/CommentAndDescription/index.tsx"), /!cachedLayout && !_mbl && secondaryPanelsReady !== false && \(\s*(\/\/[^\n]*\n\s*)?<SettledComposerSlot settled=\{threadSettled\} slotRef=\{composerSlotRef\}>/);
  assert.match(read("src/app/detail/[...slug]/TaskDetailPanels.tsx"), /_mbl && !embedded && secondaryPanelsReady !== false && <SettledComposerSlot settled=\{threadSettled\} slotRef=\{composerSlotRef\}>/);
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

test("the hard stop runs even when the flags request never answers", () => {
  const source = read("src/hooks/Task Detail/useThreadSettled.ts");
  assert.match(source, /MAX_HOLD_MS = 5000/);
  assert.match(source, /const timer = setTimeout\(\(\) => setSettled\(true\), MAX_HOLD_MS\)/);
  assert.doesNotMatch(source.split("const timer")[0].split("useEffect").at(-1), /ready/, "the hard stop is not gated on flags or hydration");
});

test("a comment that has not mounted its body yet (8 px of padding) holds the box until it has grown", async (t) => {
  await withHarness(t, { boxTop: { current: 400 } }, async ({ seen, commentHeight, frame }) => {
    commentHeight.current = 8;
    await frame(0);
    for (let i = 0; i < 40; i += 1) await frame(16);
    assert.equal(seen.at(-1), false, "the position is still but the last comment is not rendered");
    commentHeight.current = 74;
    for (let i = 0; i < 25; i += 1) await frame(16);
    assert.equal(seen.at(-1), true);
  });
});
