const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const FLAG = "htpr-7097-deleted-view-leaves-tabs";

// Loads useKanbanViews.ts with every import mocked; the hook only calls mocked hooks,
// so it can be invoked outside a React render.
function loadHook({ flagOn, calls }) {
  const file = "src/hooks/Homepage/Views/useKanbanViews.ts";
  const filename = path.join(root, file);
  const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const projectView = { id: "pv", projectId: 15, allViews: [], user_project_views: [] };
  const queryClient = {
    invalidateQueries: async (options) => { calls.push(["invalidate", options]); },
    refetchQueries: async (options) => { calls.push(["refetch", options]); },
  };
  const mocks = {
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    axios: { delete: async () => ({ status: 200, data: projectView }) },
    "react-hot-toast": { __esModule: true, default: {} },
    nookies: { __esModule: true, default: {} },
    "next/navigation": { useRouter: () => ({ replace() {} }) },
    "@/lib/state": {
      useRecoilState: () => [undefined, () => {}],
      useRecoilValue: () => ({}),
      useSetRecoilState: () => () => {},
    },
    "@/hooks/useFlag": { useFlag: (key) => (key === FLAG ? flagOn : false) },
    "@/lib/flags/keys": { HTPR_7097_DELETED_VIEW_LEAVES_TABS_FLAG: FLAG },
    "@/hooks/MultiPages/useUpdateTaskInBoards": {
      __esModule: true,
      default: () => ({
        getProjectIdxAndAllData: () => ({}),
        updateProjectView: () => { calls.push(["patch"]); },
      }),
    },
    "@/lib/boardSync/reconcileActiveBoardQuery": {
      // Same order as the real helper: expire boardTasks for this project, then refetch projectsAll.
      reconcileActiveBoardQuery: async (client, projectId) => {
        await client.invalidateQueries({
          predicate: (query) => query.queryKey[0] === "boardTasks" && query.queryKey[2] === projectId,
        });
        await client.refetchQueries({ queryKey: ["projectsAll"] });
      },
    },
    "@/lib/constants/APIRouteConstants": { deleteRenameViewAPIRoute: "/api/del" },
    "@/utils/helperFunctions/Views/ProjectViewState": {
      isProjectViewResponseForBoard: () => true,
    },
  };
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = (request) => {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    if (request.startsWith("@/") || request.startsWith(".")) {
      return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? true : () => ({})) });
    }
    return require(request);
  };
  loaded._compile(js, filename);
  return loaded.exports.default;
}

async function deleteAfterBuiltinVisit(flagOn) {
  const calls = [];
  const useKanbanViews = loadHook({ flagOn, calls });
  const project = { id: 15, project_view: { user_project_views: [{ appliedView: { id: "other" } }] } };
  const { deleteView } = useKanbanViews(project);
  await deleteView("saved", 15);
  await new Promise((resolve) => setImmediate(resolve));
  return calls;
}

test("flag on: delete expires this board's cached boardTasks before refetching projectsAll", async () => {
  const calls = await deleteAfterBuiltinVisit(true);
  const kinds = calls.map((call) => call[0]);
  assert.deepEqual(kinds, ["patch", "invalidate", "refetch"]);
  const { predicate } = calls[1][1];
  assert.equal(predicate({ queryKey: ["boardTasks", 6, 15] }), true);
  assert.equal(predicate({ queryKey: ["boardTasks", 6, 16] }), false);
  assert.equal(predicate({ queryKey: ["projectsAll"] }), false);
  assert.deepEqual(calls[2][1], { queryKey: ["projectsAll"] });
});

test("flag off: delete behaves as before and leaves boardTasks alone", async () => {
  const calls = await deleteAfterBuiltinVisit(false);
  assert.deepEqual(calls.map((call) => call[0]), ["patch", "refetch"]);
});

test("the flag is registered as an Everyone-by-default bugfix with release risk", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/flags/definitions/htpr-7097-deleted-view-leaves-tabs.ts"), "utf8");
  assert.match(src, /kind: "bugfix"/);
  assert.match(src, /releaseRisk/);
  assert.match(src, /htpr-7097-deleted-view-leaves-tabs/);
});
