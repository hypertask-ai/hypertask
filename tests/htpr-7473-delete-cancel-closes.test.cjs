const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7473-delete-cancel-closes";
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function load(file, mocks) {
  const mod = { exports: {} };
  new Function("require", "module", "exports", compile(fs.readFileSync(path.join(root, file), "utf8")))(
    (key) => {
      if (Object.hasOwn(mocks, key)) return { __esModule: true, ...mocks[key] };
      if (key.startsWith("@/lib/flags/")) return require("./helpers/flag-files.cjs").load(`src/${key.slice(2)}.ts`);
      if (key.startsWith("@/")) throw new Error(`Unstubbed dependency: ${key}`);
      return require(key);
    }, mod, mod.exports,
  );
  return mod.exports;
}

function fixture(flagOn) {
  const calls = { deleted: [], navigations: [], modalToggles: 0, boardCloses: 0 };
  const useFlag = (key) => key === flagKey ? flagOn : false;
  const navigate = (page, payload) => calls.navigations.push(payload === undefined ? page : `${page} ${payload}`);
  const kanban = () => ({
    deleteTodo: async () => {},
    updateTaskInCache: () => {},
    removeFromListWithStatus: async (sectionId, projectId, taskId, status) => calls.deleted.push([taskId, status]),
  });
  const task = { id: 101, projectId: 42, status: "Normal" };
  const context = {
    currentTask: task, currentUser: { id: 985 },
    queryClient: { refetchQueries: async () => {} },
    setCurrentTask: () => {}, navigate, onGoback: () => navigate("Back"),
    toggleDeleteModal: () => { calls.modalToggles++; },
  };
  const { useTaskDetailModalActions } = load("src/app/detail/[...slug]/useTaskDetailModalActions.tsx", {
    "@/utils/api/global": { default: { deleteTaskAPI: async (id) => { calls.deleted.push([id, "Deleted"]); return task; } } },
    "@/lib/configs/taskDetail.config": { default: { taskStatus: { deleted: "Deleted" }, queryKeys: {}, toastMessages: {}, navigation: {} } },
    "@/hooks/useFlag": { useFlag },
    "@/lib/taskDetailReads": { refreshTaskDetailReadAfterWrite: () => {} },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { default: kanban },
    "react-hot-toast": { default: () => {} },
  });
  const palette = load("src/hooks/MultiPages/HTC/useHTCTaskAndComments.ts", {
    "@/hooks/Task Detail/useStarAndPin": { useStarAndPin: () => ({}) },
    "@/hooks/General/useCopyURL": { default: () => ({}) },
    "next/navigation": { usePathname: () => "/detail/project-42/7" },
    "../useUpdateTaskInBoards": { default: kanban },
    "@/components/undoToast": {},
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "../Route/useHypertasksNavigate": { default: () => ({ navigate }) },
    "@/lib/constants/APIRouteConstants": {},
    "./useCreateTask": { default: () => ({}) },
    "@/hooks/General/useFollowerKanban": { default: () => ({}) },
    "../Tasks": { useRemoveParentTask: () => ({}) },
    "@/hooks/General/useProjectQuery": { useProjectQuery: () => ({}) },
    "@/hooks/useFlag": { useFlag },
  }).default({
    inViewObject: { taskId: 101, sectionId: 9, taskProjectId: 42 }, _currentProject: { id: 42 }, currentUser: { id: 985 },
    callbackHandler: () => {}, boardCloseHandler: () => { calls.boardCloses++; },
  });
  return { calls, detail: useTaskDetailModalActions(() => context), palette };
}

test("the fix is a small bugfix flag that is on for ordinary customers by default", () => {
  const flags = load("src/lib/flags.ts", { "@/lib/prisma": { default: {} } });
  assert.equal(flags.featureFlagModeEnabled(flags.defaultFeatureFlagMode(flagKey), false, false), true);
  const definition = require("./helpers/flag-files.cjs").definitions().find(item => item.key === flagKey);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.releaseRisk.risk, "small");
});

test("Cancel in the ticket page Shift+3 dialog closes it without deleting or leaving", async () => {
  const { calls, detail } = fixture(true);
  await detail.deleteTask(false);
  assert.equal(calls.modalToggles, 1);
  assert.deepEqual(calls.deleted, []);
  assert.deepEqual(calls.navigations, []);
});

test("Cancel in the ticket page command palette dialog closes it and stays on the ticket", async () => {
  const { calls, palette } = fixture(true);
  await palette.confirmDelete(false);
  assert.equal(calls.boardCloses, 1);
  assert.deepEqual(calls.deleted, []);
  assert.deepEqual(calls.navigations, []);
});

test("confirming still deletes and leaves the ticket from both dialogs", async () => {
  const hash = fixture(true);
  await hash.detail.deleteTask(true);
  assert.deepEqual(hash.calls.deleted, [[101, "Deleted"]]);
  assert.equal(hash.calls.modalToggles, 1);
  assert.deepEqual(hash.calls.navigations, ["Back"]);

  const palette = fixture(true);
  await palette.palette.confirmDelete(true);
  assert.deepEqual(palette.calls.deleted, [[101, "Deleted"]]);
  assert.equal(palette.calls.boardCloses, 1);
  assert.deepEqual(palette.calls.navigations, ["Back"]);
});

test("flag off keeps the old Cancel behaviour", async () => {
  const { calls, detail, palette } = fixture(false);
  await detail.deleteTask(false);
  assert.equal(calls.modalToggles, 0);
  await palette.confirmDelete(false);
  assert.equal(calls.boardCloses, 1);
  assert.deepEqual(calls.navigations, ["Back"]);
  assert.deepEqual(calls.deleted, []);
});
