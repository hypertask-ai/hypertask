const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function load(file, mocks = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", js)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const flagFile = "src/lib/flags/definitions/htpr-7685-chat-follows-board.ts";
const flag = load(flagFile);
const atoms = { currentProjectAtom: "currentProject", dockedChatScopeAtom: "dockedChatScope", dockedChatScopePickedOnBoardAtom: "pickedOn" };

function chat({ enabled = true, savedScope = null, board = 1 } = {}) {
  const values = new Map([["currentProject", { id: board }], ["dockedChatScope", savedScope], ["pickedOn", null]]);
  const setter = (atom) => (next) => values.set(atom, typeof next === "function" ? next(values.get(atom)) : next);
  const { useDockedChatScope } = load("src/hooks/MultiPages/AIChat/useDockedChatScope.ts", {
    react: { useCallback: (fn) => fn, useEffect: (effect) => { effect(); } },
    "@/lib/state": {
      useRecoilState: (atom) => [values.get(atom), setter(atom)],
      useRecoilValue: (atom) => values.get(atom),
      useSetRecoilState: setter,
    },
    "@/store": atoms,
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flag.HTPR_7685_CHAT_FOLLOWS_BOARD_FLAG); return enabled; } },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/definitions/htpr-7685-chat-follows-board": flag,
  });
  return {
    scope: () => useDockedChatScope()[0],
    pick: (scope) => useDockedChatScope()[1](scope),
    visit: (id) => values.set("currentProject", { id }),
    saved: () => values.get("dockedChatScope"),
  };
}

test("a board saved in an earlier visit does not follow you: the chat shows the board you are on", () => {
  const view = chat({ savedScope: 99, board: 1 });
  assert.equal(view.scope(), null);
  view.visit(2);
  assert.equal(view.scope(), null);
});

test("a hand pick applies on the board where it was made and not on the next board", () => {
  const view = chat({ board: 1 });
  view.pick(2);
  assert.equal(view.scope(), 2);
  view.pick("all");
  assert.equal(view.scope(), "all");
  view.visit(3);
  assert.equal(view.scope(), null);
  view.pick("ticket");
  assert.equal(view.scope(), "ticket");
  view.visit(1);
  assert.equal(view.scope(), null);
});

test("a hand pick does not come back when you return to the board where it was made", () => {
  const view = chat({ board: 2 });
  view.pick(1);
  assert.equal(view.scope(), 1);
  view.visit(1);
  assert.equal(view.scope(), null);
  view.visit(2);
  assert.equal(view.scope(), null);
});

test("flag off keeps the saved picker board on every page", () => {
  const view = chat({ enabled: false, savedScope: 99, board: 1 });
  assert.equal(view.scope(), 99);
  view.visit(2);
  assert.equal(view.scope(), 99);
  view.pick(5);
  view.visit(3);
  assert.equal(view.scope(), 5);
  assert.equal(view.saved(), 5);
});

test("bugfix flag is on for Everyone with a release-risk reason", () => {
  const definition = flag.default;
  assert.equal(definition.key, "htpr-7685-chat-follows-board");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});

test("every docked chat reader takes the scope from the board-aware hook", () => {
  for (const file of ["src/components/AI_CHAT/AI_Tiptap_Container.tsx", "src/hooks/MultiPages/AIChat/useAiChatState.ts", "src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts"]) {
    const source = read(file);
    assert.match(source, /useDockedChatScope\(\)/, file);
    assert.doesNotMatch(source, /useRecoil(State|Value)\(dockedChatScopeAtom\)/, file);
  }
});
