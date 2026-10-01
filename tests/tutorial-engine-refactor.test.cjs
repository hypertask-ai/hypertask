const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const hooksRoot = path.join(__dirname, "../src/hooks/General");

function loadModule(file, mocks, globals = {}, cache = new Map()) {
  const filename = path.join(hooksRoot, file);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith(".")) return loadModule(`${name}.ts`, mocks, globals, cache);
      throw new Error(`Unexpected import: ${name}`);
    },
    ...globals,
  }, { filename });
  return exports;
}

function keyboardEvent(key, extra = {}) {
  const calls = [];
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    preventDefault: () => calls.push("preventDefault"),
    stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
    calls,
    ...extra,
  };
}

for (const capture of [undefined, true]) {
  test(`engine preserves listener options and cleanup order: capture=${capture}`, () => {
    const calls = [];
    let cleanup;
    const dependencies = [];
    const target = {
      addEventListener: (...args) => calls.push(["add", ...args]),
      removeEventListener: (...args) => calls.push(["remove", ...args]),
    };
    const { useTutorialEngine } = loadModule("useTutorialEngine.ts", {
      react: { useEffect: (effect, deps) => {
        assert.equal(deps, dependencies);
        cleanup = effect();
      } },
    });
    const handleKeyDown = () => {};
    const handleKeyUp = () => {};
    const handlePointerDown = capture ? () => {} : undefined;
    useTutorialEngine(() => ({
      target,
      capture,
      handleKeyDown,
      handleKeyUp,
      handlePointerDown,
      onCleanup: () => calls.push(["cleanup"]),
    }), dependencies);
    cleanup();
    const expected = [
      ["add", "keydown", handleKeyDown, capture],
      ["add", "keyup", handleKeyUp, capture],
      ...(capture ? [["add", "pointerdown", handlePointerDown, capture]] : []),
      ["cleanup"],
      ["remove", "keydown", handleKeyDown, capture],
      ["remove", "keyup", handleKeyUp, capture],
      ...(capture ? [["remove", "pointerdown", handlePointerDown, capture]] : []),
    ];
    assert.deepEqual(calls, expected);
  });
}

test("inactive engine setup registers nothing and has no cleanup", () => {
  const { useTutorialEngine } = loadModule("useTutorialEngine.ts", {
    react: { useEffect: (effect) => assert.equal(effect(), undefined) },
  });
  useTutorialEngine(() => undefined, []);
});

function learnKeyboard(scene) {
  const calls = [];
  const document = {
    activeElement: null,
    getElementById: () => null,
    querySelector: () => null,
  };
  const handlers = loadModule("learnTutorialKeyboardHandlers.ts", {
    "@/lib/tutorial/learnTutorialState": { canOpenLearnTutorialTask: () => false },
  }, { document });
  const context = {
    tutorialState: { scene, verifiedBoardMoves: [], lastTaskId: 10 },
    pathname: "/detail/project-15/10",
    setPressedKey: (key) => calls.push(["pressed", key]),
    exitTutorial: () => calls.push(["exit"]),
    continueTutorial: () => calls.push(["continue"]),
    expectSurface: (...args) => calls.push(["surface", ...args]),
    revealSurfaceAfterShortcut: (...args) => calls.push(["reveal", args[0]]),
    pendingEscapeFromDetail: { current: false },
    pendingBoardMove: { current: null },
  };
  const task = handlers.createLearnTutorialTaskKeyHandler(context);
  const inbox = handlers.createLearnTutorialInboxKeyHandler(context, task);
  const handleKeyDown = handlers.createLearnTutorialBoardKeyHandler(context, inbox);
  return { calls, context, handleKeyDown, document };
}

test("board handler consumes exit shortcuts without falling through", () => {
  const { calls, handleKeyDown } = learnKeyboard("welcome");
  const event = keyboardEvent(".", { code: "Period", ctrlKey: true });
  handleKeyDown(event);
  assert.deepEqual(calls, [["exit"]]);
  assert.deepEqual(event.calls, ["preventDefault", "stopImmediatePropagation"]);
});

test("board handler preserves shortcut handoff to the real modal", () => {
  const { calls, handleKeyDown } = learnKeyboard("boardSwitcher");
  const event = keyboardEvent("b", { metaKey: true });
  handleKeyDown(event);
  assert.deepEqual(calls, [["surface", "board-switcher", 5000], ["reveal", "board-switcher"], ["pressed", "b"]]);
  assert.deepEqual(event.calls, []);
});

test("inbox handler consumes blocked scenes without task-handler fallthrough", () => {
  const { calls, handleKeyDown } = learnKeyboard("inboxZero");
  const event = keyboardEvent("Enter");
  handleKeyDown(event);
  assert.deepEqual(calls, []);
  assert.deepEqual(event.calls, ["preventDefault", "stopImmediatePropagation"]);
});

test("task handler receives welcome Enter through both preceding handlers", () => {
  const { calls, handleKeyDown } = learnKeyboard("welcome");
  const event = keyboardEvent("Enter");
  handleKeyDown(event);
  assert.deepEqual(calls, [["pressed", "enter"], ["continue"]]);
  assert.deepEqual(event.calls, ["preventDefault", "stopImmediatePropagation"]);
});

test("comment shortcut still prevents default without stopping propagation", () => {
  const { calls, handleKeyDown } = learnKeyboard("comment");
  const event = keyboardEvent("m", { ctrlKey: true });
  handleKeyDown(event);
  assert.deepEqual(calls, [["surface", "comment-editor"], ["pressed", "m"]]);
  assert.deepEqual(event.calls, ["preventDefault"]);
});

test("movement Enter remains blocked until verified task focus", () => {
  const { calls, handleKeyDown } = learnKeyboard("movement");
  const event = keyboardEvent("Enter");
  handleKeyDown(event);
  assert.deepEqual(calls, []);
  assert.deepEqual(event.calls, ["preventDefault", "stopImmediatePropagation"]);
});

test("step data keeps movement order, arrow aliases, and fresh move definitions", () => {
  const { getLearnTutorialBoardMove, learnTutorialReleasedHints } = loadModule("learnTutorialSteps.ts", {});
  for (const [scene, verifiedBoardMoves, direction, keys] of [
    ["moveAcross", [], "right", ["l", "arrowright"]],
    ["moveAcross", ["right"], "left", ["h", "arrowleft"]],
    ["reorder", [], "down", ["j", "arrowdown"]],
    ["reorder", ["down"], "up", ["k", "arrowup"]],
  ]) {
    const state = { scene, verifiedBoardMoves };
    const move = getLearnTutorialBoardMove(state);
    assert.equal(move.direction, direction);
    assert.deepEqual(Array.from(move.keys), keys);
    assert.notEqual(move, getLearnTutorialBoardMove(state));
  }
  assert.equal(getLearnTutorialBoardMove({ scene: "welcome" }), null);
  assert.deepEqual({ ...learnTutorialReleasedHints }, {
    arrowleft: "h", arrowdown: "j", arrowup: "k", arrowright: "l",
  });
});

test("legacy step factories preserve all 34 handlers and the first scene", () => {
  const steps = loadModule("tutorialSteps.ts", {
    "@/lib/constants/InteractiveOnboarding/constants": {},
    "@/lib/constants/constants": {},
    "react-hot-toast": {},
  });
  const calls = [];
  let state = { scene0: false };
  const context = {
    setSceneState: (update) => { state = update(state); },
    updateScene: (...args) => calls.push(args),
    errorShake: () => calls.push("shake"),
  };
  const handlers = Object.assign({}, ...Object.values(steps).map((factory) => factory(context)));
  assert.deepEqual(Object.keys(handlers), Array.from({ length: 34 }, (_, index) => `scene${index}`));
  const enter = keyboardEvent("Enter");
  handlers.scene0(enter);
  assert.equal(state.scene0, true);
  assert.deepEqual(calls, [[undefined, false, 0]]);
  assert.deepEqual(enter.calls, ["preventDefault"]);
  handlers.scene0(keyboardEvent("x"));
  assert.equal(calls[1], "shake");
});
