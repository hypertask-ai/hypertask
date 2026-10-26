const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");
const root = path.resolve(__dirname, "..");
const flush = () => new Promise(setImmediate);

function ui(file, data, error) {
  const calls = [], states = [], effects = [], timers = [], toasts = [];
  let cursor = 0;
  const read = async (name, ...args) => { calls.push([name, ...args]); if (error) throw error; return { data }; };
  const react = {
    useState: (value) => { const index = cursor++; if (!(index in states)) states[index] = value; return [states[index], (next) => { states[index] = next; }]; },
    useEffect: (callback, dependencies) => effects.push({ callback, dependencies }),
    useMemo: (callback) => callback(),
  };
  const mocks = {
    react,
    "@/lib/api/typedClient": {
      getDescriptionVersions: (...args) => read("typed-versions", ...args),
      getTaskCycle: async (...args) => (await read("typed-cycle", ...args)).data,
    },
    axios: { default: { get: (...args) => read("legacy-versions", ...args), post: (...args) => read("restore", ...args), isCancel: (caught) => caught?.name === "CanceledError" } },
    "react-hot-toast": { default: { error: (value) => toasts.push(value), success() {} } },
    "@/lib/constants/APIRouteConstants": { taskDescriptionVersionsRoute: (id) => `/api/tasks/${id}/description-versions`, taskDescriptionRestoreRoute: (id) => `/api/tasks/${id}/description-restore` },
    "@/lib/cycles": { cycleDateRange: () => "date range" },
  };
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", javascript)((name) => {
    if (mocks[name]) return { __esModule: true, ...mocks[name] };
    if (name === "react/jsx-runtime") return require(name);
    return new Proxy({}, { get: (_, property) => property === "__esModule" ? true : String(property) });
  }, loadedModule, loadedModule.exports);
  return { calls, states, effects, timers, toasts, render: (props) => { cursor = 0; return loadedModule.exports.default(props); } };
}
function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

test("history always uses typed reads, preserving cancellation and restore", async () => {
  const data = { current: { contentText: "Current" }, hasMore: false, versions: [{ id: 7, version: 1, contentText: "Old", createdAt: "2026-10-06", actor: { type: "user", displayName: "QA" } }] };
  const h = ui("src/components/Modals/TaskDescriptionHistory/TaskDescriptionHistoryModal.tsx", data);
  let restored = 0, closed = 0;
  const props = { taskId: 12, onClose: () => closed++, onRestored: () => restored++ };
  h.render(props);
  const cleanup = h.effects[0].callback();
  await flush();
  const signal = h.calls[0].at(-1).signal ?? h.calls[0].at(-1);
  assert.deepEqual(h.calls, [["typed-versions", 12, signal]]);
  assert.equal(h.states[0], data);
  assert.equal(h.states[1], 7);
  assert.equal(h.states[2], false);
  assert.deepEqual(h.effects[0].dependencies, [12]);
  assert.deepEqual(elements(h.render(props)).filter((node) => typeof node.props?.content === "string").map((node) => node.props.content), ["Current", "Old"]);
  const restore = elements(h.render(props)).find((node) => node.type === "button" && JSON.stringify(node.props?.children).includes("Restore this version"));
  assert.ok(restore); restore.props.onClick();
  const confirm = elements(h.render(props)).find((node) => node.props?.id === "confirm-description-restore");
  confirm.props.onConfirm(); await flush();
  assert.deepEqual(h.calls[1], ["restore", "/api/tasks/12/description-restore", { version_id: 7 }]);
  assert.equal(restored, 1); assert.equal(closed, 1);
  cleanup(); assert.equal(signal.aborted, true);
  for (const error of [new Error("denied"), Object.assign(new Error("cancel"), { name: "CanceledError" })]) {
    const failed = ui("src/components/Modals/TaskDescriptionHistory/TaskDescriptionHistoryModal.tsx", data, error);
    failed.render(props); failed.effects[0].callback(); await flush();
    assert.equal(failed.toasts.length, error.name === "CanceledError" ? 0 : 1);
    assert.equal(failed.states[2], false);
  }
});

test("cycle always uses typed reads, preserving search, cleanup and native mutation", async (t) => {
  const data = { enabled: true, assignedCycle: null, cycles: [{ id: 3, number: 2, assignable: true }] };
  const h = ui("src/components/Modals/CyclePicker/index.tsx", data);
  t.mock.method(global, "fetch", async (...args) => { h.calls.push(["fetch", ...args]); return Response.json(args[1].method === "POST" ? { cycle: null } : data); });
  const previousWindow = global.window;
  global.window = { setTimeout: (callback, delay) => { h.timers.push({ callback, delay }); return 1; }, clearTimeout() {} };
  t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });
  let changed = 0;
  const props = { taskId: 12, assignedCycle: null, closeHandler() {}, onChange: () => changed++ };
  h.render(props); const cleanup = h.effects[0].callback();
  assert.equal(h.timers[0].delay, 0); await h.timers[0].callback();
  const signal = h.calls[0].at(-1).signal ?? h.calls[0].at(-1);
  assert.deepEqual(h.calls, [["typed-cycle", { taskId: 12 }, signal]]);
  assert.deepEqual(h.states[0], data.cycles); assert.equal(h.states[3], false);
  const search = elements(h.render(props)).find((node) => node.props?.placeholder === "Search cycles");
  search.props.onChange({ target: { value: "  Cycle 2  " } });
  h.render(props); h.effects.at(-1).callback();
  assert.equal(h.timers.at(-1).delay, 180); await h.timers.at(-1).callback();
  const last = h.calls.at(-1);
  assert.equal(last[0], "typed-cycle");
  assert.deepEqual(last[1], { taskId: 12, query: "Cycle 2" });
  elements(h.render(props)).find((node) => node.props?.id === "cycle-none").props.onClick(); await flush();
  assert.deepEqual(h.calls.at(-1), ["fetch", "/api/tasks/cycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: 12, cycleId: null }) }]);
  assert.equal(changed, 1); cleanup(); assert.equal(signal.aborted, true);
  assert.deepEqual(h.effects[0].dependencies, ["", 12]);
});

function boardApi(early) {
  const calls = [];
  const data = { project: { id: 15 }, tasks: [{ id: 1 }], allViews: [] };
  const api = load("src/utils/api/Homepage/index.ts", {
    axios: { default: { post: async (...args) => { calls.push(["legacy", ...args]); return { data }; } } },
    "@/utils/axiosClient": {}, "@/utils/helperFunctions/helperFunctions": {}, "@/lib/firstScreen/boardPayload": {}, "@/utils/api/Homepage/sidebarTeamsResponse": {},
    "@/lib/boardBootstrap/earlyBoardBootstrap": { consumeEarlyBoardBootstrap: async () => early }, "@/lib/appShellBootstrap/client": {}, "@/lib/boardSync/startupRace": {},
    "@/lib/analytics/boardReadinessPhases": { getBoardReadinessTraceScope: () => null, markBoardReadinessPhase() {} },
  });
  return { api, calls, data, typedRead: async (...args) => { calls.push(["typed", ...args]); return { data }; } };
}

for (const typedReadEnabled of [false, true]) {
  test(`board helper typed reader ${typedReadEnabled}: same signal, payload and early bootstrap`, async () => {
    const h = boardApi(); const signal = new AbortController().signal;
    assert.deepEqual(await h.api.fetchBoardTasks(15, 985, signal, typedReadEnabled ? h.typedRead : undefined), h.data);
    assert.deepEqual(h.calls, typedReadEnabled ? [["typed", { projectId: 15, userId: 985 }, signal]] : [["legacy", "/api/projects/boardTasks", { projectId: 15, userId: 985 }, { signal }]]);
    const bootstrapped = boardApi(h.data);
    assert.deepEqual(await bootstrapped.api.fetchBoardTasks(15, 985, signal, typedReadEnabled ? bootstrapped.typedRead : undefined), h.data);
    assert.deepEqual(bootstrapped.calls, []);
  });
}

test("board consumers always use typed reads for authorization, side cache and warming", async () => {
  const calls = [], effects = []; let query;
  const typedRead = async () => undefined;
  const cache = { getQueryState: () => undefined, getQueryData: () => undefined, setQueryData() {}, fetchQuery: async (config) => config.queryFn({ signal }), prefetchQuery: async (config) => config.queryFn({ signal }) };
  const signal = new AbortController().signal;
  const api = load("src/hooks/Homepage/useGetBoards.ts", {
    react: { useRef: (current) => ({ current }), useEffect: (callback) => effects.push(callback), useLayoutEffect: (callback) => callback() },
    "@/hooks/useFlag": { useFlag: (requested) => { assert.equal(requested, "htpr-7129-board-card-fresh-after-escape"); return false; } },
    "@/lib/flags/keys": { HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG: "htpr-7129-board-card-fresh-after-escape" }, "@/lib/api/typedClient": { getBoardDetail: typedRead },
    "@tanstack/react-query": { useQueryClient: () => cache, useQuery: (config) => { query = config; return {}; } },
    "@/hooks/General/useHydrated": { useHydrated: () => true }, "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
    "@/lib/firstScreen/boardDocument": { getBoardDocument: () => null }, "@/lib/boardBootstrap/earlyBoardBootstrap": {},
    "@/hooks/MultiPages/useGetAllAccessibleBoardList": {}, "@/lib/boardSync/revocationTombstone": {},
    "@/utils/api/Homepage": {
      BOARD_TASKS_KEY: (projectId, userId) => ["boardTasks", userId, projectId],
      fetchBoardTasks: async (...args) => { calls.push(args); return { project: { id: 15 }, tasks: [], allViews: [] }; },
      getAllProjects: async (_user, _slugs, options) => { await options.boardPayloadPromise; return { updatedProjects: [] }; },
    },
  });
  api.useGetAllBoards({ id: 985 }, "15");
  await query.queryFn({ signal }); await query.queryFn({ signal });
  api.useWarmProjectsAllQuery({ user: { id: 985 }, projectId: 15 }); effects.at(-1)(); await flush();
  assert.equal(calls.length, 3);
  for (const args of calls) assert.deepEqual(args, [15, 985, signal, typedRead]);
});
