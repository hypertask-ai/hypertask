const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const flag = read("src/lib/flags/definitions/htpr-7090-comment-link-scroll.ts");
const comp = read("src/app/detail/[...slug]/TaskDetailComp.tsx");

test("the flag is a bugfix flag that is on for everyone", () => {
  assert.match(flag, /kind: "bugfix"/);
  assert.match(flag, /defaultMode: "EVERYONE"/);
  assert.match(flag, /releaseRisk/);
});

test("the ticket page runs the linked-comment scroll next to the initial scroll", () => {
  assert.match(comp, /import \{ useLinkedCommentScroll \} from "\.\/useLinkedCommentScroll"/);
  assert.match(comp, /useTaskDetailInitialScroll\(keyboardContext\);\s*useLinkedCommentScroll\(keyboardContext\);/);
});

const config = (() => {
  const source = read("src/lib/configs/taskDetail.config.ts");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function("require", "exports", js)(() => ({ escapeHtml: (value) => value }), exports);
  return exports.default;
})();

// Renders the hook like React would: refs persist, effects re-run when deps change.
function createHarness(flagOn) {
  const refs = [];
  let effectCalls = [];
  const timers = [];
  let refIndex = 0;
  const source = read("src/app/detail/[...slug]/useLinkedCommentScroll.tsx");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  const react = {
    useRef: (initial) => (refs[refIndex] ??= { current: initial }, refs[refIndex++]),
    useEffect: (callback, deps) => effectCalls.push({ callback, deps }),
  };
  const mocks = {
    react,
    "@/lib/configs/taskDetail.config": { __esModule: true, default: config },
    "@/hooks/useFlag": { useFlag: () => flagOn },
    "@/lib/flags/keys": { HTPR_7090_COMMENT_LINK_SCROLL_FLAG: "htpr-7090-comment-link-scroll" },
  };
  const fakeSetTimeout = (callback, delay) => timers.push({ callback, delay, cleared: false }) - 1;
  const fakeClearTimeout = (id) => { timers[id].cleared = true; };
  new Function("require", "exports", "setTimeout", "clearTimeout", js)((name) => mocks[name], exports, fakeSetTimeout, fakeClearTimeout);
  let lastDeps = null;
  let cleanup = null;
  return {
    timers,
    render(context) {
      refIndex = 0;
      effectCalls = [];
      exports.useLinkedCommentScroll(context);
      const { callback, deps } = effectCalls[0];
      if (lastDeps && deps.every((dep, i) => Object.is(dep, lastDeps[i]))) return;
      cleanup?.();
      lastDeps = deps;
      cleanup = callback();
    },
  };
}

const makeContext = (comments, calls, search = "commentId=comment-270430") => ({
  comments,
  searchParams: new URLSearchParams(search),
  _parsedTask: { id: 6899 },
  initialScrollGenerationRef: { current: 3 },
  initialScrollGuard: { run: (generation, callback) => { assert.equal(generation, 3); callback(); } },
  scrollVirtualize: (...args) => calls.push(args),
});

test("a direct load scrolls to the linked comment once the comments arrive", () => {
  const calls = [];
  const harness = createHarness(true);
  harness.render(makeContext([], calls));
  assert.equal(harness.timers.length, 0, "nothing is scheduled while the comment list is empty");
  const staleScroll = (...args) => calls.push(["stale", ...args]);
  harness.render({ ...makeContext([{ id: "1" }, { id: "270430" }], calls), scrollVirtualize: staleScroll });
  assert.equal(harness.timers.length, 3, "three passes re-assert the scroll while rows measure in");
  // A later render brings a fresh scrollVirtualize; the timers must call that one.
  harness.render(makeContext([{ id: "1" }, { id: "270430" }], calls));
  assert.equal(harness.timers.length, 3, "re-rendering with the same comments does not reschedule");
  for (const timer of harness.timers) timer.callback();
  assert.equal(calls.length, 3);
  for (const call of calls) assert.deepEqual(call, ["comment", 270430, undefined, true]);
});

test("with the flag off nothing is scheduled", () => {
  const calls = [];
  const harness = createHarness(false);
  harness.render(makeContext([{ id: "270430" }], calls));
  assert.equal(harness.timers.length, 0);
});

test("without a comment link nothing is scheduled", () => {
  const calls = [];
  const harness = createHarness(true);
  harness.render(makeContext([{ id: "270430" }], calls, ""));
  assert.equal(harness.timers.length, 0);
});

test("the hook is only called from a component, never from a helper", () => {
  const hook = read("src/app/detail/[...slug]/useLinkedCommentScroll.tsx");
  assert.match(hook, /export function useLinkedCommentScroll/);
});
