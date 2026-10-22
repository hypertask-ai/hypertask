const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { QueryClient } = require("@tanstack/react-query");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

function load(relative) {
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(require, exports);
  return exports;
}

const target = load("src/lib/keyboard/boardShortcutTarget.ts");
const userId = 2343;
const currentBoard = 6859;
const previousBoard = 8778;

function setup({ scoped, unscoped, fresh = [{ id: currentBoard }, { id: previousBoard }], fail = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (scoped) queryClient.setQueryData(["projectsAllMinimal", userId], scoped, { updatedAt: Date.now() - 5 * 60_000 });
  if (unscoped) queryClient.setQueryData(["projectsAllMinimal"], unscoped, { updatedAt: Date.now() - 5 * 60_000 });
  const calls = [];
  const fetchBoards = async () => {
    calls.push("fetch");
    if (fail) throw new Error("offline");
    return fresh;
  };
  return { queryClient, calls, fetchBoards };
}

const lookups = [
  ["fresh list (flag off)", target.boardFromFreshList],
  ["device first (flag on)", target.boardFromDeviceFirst],
];

for (const [name, lookup] of lookups) {
  test(`${name}: no list on the device waits for the fresh list`, async () => {
    const { queryClient, calls, fetchBoards } = setup();
    assert.equal(await lookup(queryClient, userId, [currentBoard, previousBoard], fetchBoards), currentBoard);
    assert.deepEqual(calls, ["fetch"]);
  });

  test(`${name}: a board missing from the device list is still found in the fresh list`, async () => {
    const { queryClient, calls, fetchBoards } = setup({ scoped: [{ id: 1 }], unscoped: [] });
    assert.equal(await lookup(queryClient, userId, [undefined, previousBoard], fetchBoards), previousBoard);
    assert.deepEqual(calls, ["fetch"]);
  });

  test(`${name}: no available board and a failed list both give no board`, async () => {
    const empty = setup({ fresh: [{ id: 1 }] });
    assert.equal(await lookup(empty.queryClient, userId, [currentBoard, previousBoard], empty.fetchBoards), undefined);
    const failed = setup({ fail: true });
    assert.equal(await lookup(failed.queryClient, userId, [currentBoard, previousBoard], failed.fetchBoards), undefined);
  });

  test(`${name}: signed out never fetches`, async () => {
    const { queryClient, calls, fetchBoards } = setup({ unscoped: [{ id: currentBoard }] });
    assert.equal(await lookup(queryClient, undefined, [currentBoard], fetchBoards), undefined);
    assert.deepEqual(calls, []);
  });
}

test("flag off: a stale list on the device still waits for a fresh list", async () => {
  const { queryClient, calls, fetchBoards } = setup({ scoped: [{ id: currentBoard }] });
  assert.equal(await target.boardFromFreshList(queryClient, userId, [currentBoard], fetchBoards), currentBoard);
  assert.deepEqual(calls, ["fetch"]);
});

test("flag on: a board in the account list on the device opens before any request", async () => {
  const { queryClient, calls, fetchBoards } = setup({ scoped: [{ id: currentBoard }, { id: previousBoard }] });
  const board = target.boardFromDeviceFirst(queryClient, userId, [currentBoard, previousBoard], fetchBoards);
  assert.deepEqual(calls, []);
  assert.equal(await board, currentBoard);
});

test("flag on: the shared board list on the device counts too, in the same candidate order", async () => {
  const { queryClient, fetchBoards } = setup({ unscoped: [{ id: previousBoard }] });
  assert.equal(await target.boardFromDeviceFirst(queryClient, userId, [currentBoard, previousBoard], fetchBoards), previousBoard);
});

test("flag on: the list is refreshed in the background after opening from the device", async () => {
  const { queryClient, calls, fetchBoards } = setup({ scoped: [{ id: currentBoard }], fresh: [{ id: currentBoard }, { id: 42 }] });
  await target.boardFromDeviceFirst(queryClient, userId, [currentBoard], fetchBoards);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["fetch"]);
  assert.deepEqual(queryClient.getQueryData(["projectsAllMinimal", userId]), [{ id: currentBoard }, { id: 42 }]);
});

test("flag on: an empty placeholder list on the device does not count", async () => {
  const { queryClient, calls, fetchBoards } = setup({ scoped: [], unscoped: [] });
  assert.equal(await target.boardFromDeviceFirst(queryClient, userId, [currentBoard], fetchBoards), currentBoard);
  assert.deepEqual(calls, ["fetch"]);
});

test("g then b picks the lookup by the flag and keeps the same navigation", () => {
  const source = read("src/components/ProviderGlobal/GloablProviders.tsx");
  assert.match(source, /useFlag\(HTPR_7588_BOARD_SHORTCUT_FROM_DEVICE_FLAG\)/);
  assert.match(source, /boardShortcutFromDevice\s*\?\s*boardFromDeviceFirst\(/);
  assert.match(source, /:\s*boardFromFreshList\(/);
  assert.doesNotMatch(source, /fetchQuery<IProject\[\]>\(\{\s*queryKey: \["projectsAllMinimal", currentUser\.id\]/);
  assert.match(source, /goToProjectShortcut\(boardId, true\)/);
});
