const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");
const key = "htpr-6967-typed-task-reads";
const root = path.resolve(__dirname, "..");
const flush = () => new Promise(setImmediate);

function ui(file, flag, data, error) {
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
    "@/hooks/useFlag": { useFlag: (requested) => { assert.equal(requested, key); return flag; } },
    "@/lib/flags/keys": { HTPR_6967_TYPED_TASK_READS_FLAG: key },
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
  return { calls, states, effects, timers, toasts, cycleReader: mocks["@/lib/api/typedClient"].getTaskCycle, render: (props) => { cursor = 0; return loadedModule.exports.default(props); } };
}
function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

for (const flag of [false, undefined, true]) {
  test(`history flag ${flag}: one read, same state, cancellation, unchanged restore`, async () => {
    const data = { current: { contentText: "Current" }, hasMore: false, versions: [{ id: 7, version: 1, contentText: "Old", createdAt: "2026-10-06", actor: { type: "user", displayName: "QA" } }] };
    const h = ui("src/components/Modals/TaskDescriptionHistory/TaskDescriptionHistoryModal.tsx", flag, data);
    let restored = 0, closed = 0;
    const props = { taskId: 12, onClose: () => closed++, onRestored: () => restored++ };
    h.render(props);
    const cleanup = h.effects[0].callback();
    await flush();
    const signal = h.calls[0].at(-1).signal ?? h.calls[0].at(-1);
    assert.deepEqual(h.calls, flag ? [["typed-versions", 12, signal]] : [["legacy-versions", "/api/tasks/12/description-versions", { signal }]]);
    assert.equal(h.states[0], data);
    assert.equal(h.states[1], 7);
    assert.equal(h.states[2], false);
    assert.deepEqual(h.effects[0].dependencies, [12, flag]);
    const restore = elements(h.render(props)).find((node) => node.type === "button" && JSON.stringify(node.props?.children).includes("Restore this version"));
    assert.ok(restore); restore.props.onClick();
    const confirm = elements(h.render(props)).find((node) => node.props?.id === "confirm-description-restore");
    confirm.props.onConfirm(); await flush();
    assert.deepEqual(h.calls[1], ["restore", "/api/tasks/12/description-restore", { version_id: 7 }]);
    assert.equal(restored, 1); assert.equal(closed, 1);
    cleanup(); assert.equal(signal.aborted, true);
    for (const error of [new Error("denied"), Object.assign(new Error("cancel"), { name: "CanceledError" })]) {
      const failed = ui("src/components/Modals/TaskDescriptionHistory/TaskDescriptionHistoryModal.tsx", flag, data, error);
      failed.render(props); failed.effects[0].callback(); await flush();
      assert.equal(failed.toasts.length, error.name === "CanceledError" ? 0 : 1);
      assert.equal(failed.states[2], false);
    }
  });

  test(`cycle flag ${flag}: same debounced read/search, cleanup and native mutation`, async (t) => {
    const data = { enabled: true, assignedCycle: null, cycles: [{ id: 3, number: 2, assignable: true }] };
    const h = ui("src/components/Modals/CyclePicker/index.tsx", flag, data);
    t.mock.method(global, "fetch", async (...args) => { h.calls.push(["fetch", ...args]); return Response.json(args[1].method === "POST" ? { cycle: null } : data); });
    const previousWindow = global.window;
    global.window = { setTimeout: (callback, delay) => { h.timers.push({ callback, delay }); return 1; }, clearTimeout() {} };
    t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });
    let changed = 0;
    const props = { taskId: 12, assignedCycle: null, closeHandler() {}, onChange: () => changed++ };
    h.render(props); const cleanup = h.effects[0].callback();
    assert.equal(h.timers[0].delay, 0); await h.timers[0].callback();
    const signal = h.calls[0].at(-1).signal ?? h.calls[0].at(-1);
    assert.deepEqual(h.calls, flag ? [["typed-cycle", { taskId: 12 }, signal]] : [["fetch", "/api/tasks/cycle?taskId=12", { signal }]]);
    assert.deepEqual(h.states[0], data.cycles); assert.equal(h.states[3], false);
    const search = elements(h.render(props)).find((node) => node.props?.placeholder === "Search cycles");
    search.props.onChange({ target: { value: "  Cycle 2  " } });
    h.render(props); h.effects.at(-1).callback();
    assert.equal(h.timers.at(-1).delay, 180); await h.timers.at(-1).callback();
    const last = h.calls.at(-1);
    assert.equal(last[0], flag ? "typed-cycle" : "fetch");
    assert.deepEqual(last[1], flag ? { taskId: 12, query: "Cycle 2" } : "/api/tasks/cycle?taskId=12&query=Cycle+2");
    elements(h.render(props)).find((node) => node.props?.id === "cycle-none").props.onClick(); await flush();
    assert.deepEqual(h.calls.at(-1), ["fetch", "/api/tasks/cycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: 12, cycleId: null }) }]);
    assert.equal(changed, 1); cleanup(); assert.equal(signal.aborted, true);
    assert.deepEqual(h.effects[0].dependencies, ["", 12, flag ? h.cycleReader : undefined]);
  });
}

test("the cycle picker evaluates this ticket's switch without a reader prop", () => {
  const source = fs.readFileSync(path.join(root, "src/components/Modals/CyclePicker/index.tsx"), "utf8");
  assert.match(source, /import \{ HTPR_6967_TYPED_TASK_READS_FLAG \} from "@\/lib\/flags\/keys"/);
  assert.match(source, /const typedClient = useFlag\(HTPR_6967_TYPED_TASK_READS_FLAG\);/);
  assert.doesNotMatch(source, /readCycle|HTPR_6925_TYPED_API_CLIENT_FLAG/);
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

for (const flag of [false, undefined, true]) {
  test(`board flag ${flag}: legacy or typed read retains signal, same payload and early bootstrap`, async () => {
    const h = boardApi(); const signal = new AbortController().signal;
    assert.deepEqual(await h.api.fetchBoardTasks(15, 985, signal, flag ? h.typedRead : undefined), h.data);
    assert.deepEqual(h.calls, flag ? [["typed", { projectId: 15, userId: 985 }, signal]] : [["legacy", "/api/projects/boardTasks", { projectId: 15, userId: 985 }, { signal }]]);
    const bootstrapped = boardApi(h.data);
    assert.deepEqual(await bootstrapped.api.fetchBoardTasks(15, 985, signal, flag ? bootstrapped.typedRead : undefined), h.data);
    assert.deepEqual(bootstrapped.calls, []);
  });

  test(`board consumer flag ${flag}: active authorization, side cache and warming select reader`, async () => {
    const calls = [], effects = []; let query;
    const typedRead = async () => undefined;
    const cache = { getQueryState: () => undefined, getQueryData: () => undefined, setQueryData() {}, fetchQuery: async (config) => config.queryFn({ signal }), prefetchQuery: async (config) => config.queryFn({ signal }) };
    const signal = new AbortController().signal;
    const api = load("src/hooks/Homepage/useGetBoards.ts", {
      react: { useRef: (current) => ({ current }), useEffect: (callback) => effects.push(callback), useLayoutEffect: (callback) => callback() },
      "@/hooks/useFlag": { useFlag: (requested) => { assert.equal(requested, key); return flag; } },
      "@/lib/flags/keys": { HTPR_6967_TYPED_TASK_READS_FLAG: key }, "@/lib/api/typedClient": { getBoardDetail: typedRead },
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
    for (const args of calls) assert.deepEqual(args, [15, 985, signal, flag ? typedRead : undefined]);
  });
}
