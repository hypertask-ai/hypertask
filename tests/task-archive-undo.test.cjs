const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("task-detail archive registers a durable undo action before navigation", () => {
  const archiveSource = read("src/hooks/Task Detail/useArchiveAndNavigate.ts");
  const boardUpdateSource = read(
    "src/hooks/MultiPages/useUpdateTaskInBoards.tsx",
  );
  const undoSource = read("src/hooks/General/useUndo.tsx");

  assert.match(archiveSource, /undoRedirectPath:[\s\S]*?\/detail\/project-/);
  assert.match(
    boardUpdateSource,
    /deleteTodo\("Undo task archive",[\s\S]*?undoRedirectPath/,
  );
  assert.match(undoSource, /undoHandler: handleUndo/);
});

test("archive failures reconcile the board without exposing a false undo success", () => {
  const boardUpdateSource = read(
    "src/hooks/MultiPages/useUpdateTaskInBoards.tsx",
  );
  const archiveCall = boardUpdateSource.indexOf(
    "await globalAPIHandlers.archiveTask(taskId, status)",
  );
  const archiveUndo = boardUpdateSource.indexOf(
    'deleteTodo("Undo task archive"',
    archiveCall,
  );
  const reconciliation = boardUpdateSource.indexOf(
    'await queryClient.refetchQueries({ queryKey: ["projectsAll"] })',
    archiveUndo,
  );
  const rethrow = boardUpdateSource.indexOf("throw error", reconciliation);

  assert.ok(archiveCall >= 0 && archiveCall < archiveUndo);
  assert.ok(archiveUndo < reconciliation && reconciliation < rethrow);
});

test("delete failures reset loading and keep the confirmation available for retry", () => {
  const homepageSource = read(
    "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx",
  );
  const handler = homepageSource.slice(
    homepageSource.indexOf("const deleteTaskHandler"),
    homepageSource.indexOf("const deleteItem"),
  );
  const deleteCall = handler.indexOf("await deleteItem(");
  const successClose = handler.indexOf("toggleDeleteModal(false)", deleteCall);
  const failure = handler.indexOf("toast.error(\"Unable to delete task\")", successClose);
  const finallyBlock = handler.indexOf("finally", failure);
  const loadingReset = handler.indexOf("setLoading(false)", finallyBlock);

  assert.ok(deleteCall >= 0 && deleteCall < successClose);
  assert.ok(successClose < failure && failure < finallyBlock);
  assert.ok(finallyBlock < loadingReset);
});

test("global Ctrl or Cmd+Z invokes the latest undo outside text editors", () => {
  const undoSource = read("src/hooks/General/useUndo.tsx");
  const shortcutsSource = read("src/lib/constants/shortcuts.ts");
  const commandsSource = read(
    "src/components/Modals/commands/HTC/AllCommands.ts",
  );
  const commandHandlerSource = read("src/components/commands.tsx");

  assert.match(undoSource, /\(!event\.ctrlKey && !event\.metaKey\)/);
  assert.match(undoSource, /event\.key\.toLowerCase\(\) !== "z"/);
  assert.match(undoSource, /active!\.tagName === "INPUT"/);
  assert.match(undoSource, /active!\.tagName === "TEXTAREA"/);
  assert.match(undoSource, /active!\.isContentEditable/);
  assert.match(undoSource, /await pendingUndo\.undoHandler/);
  assert.match(undoSource, /consumedUndoIds\.current\.has/);
  assert.match(undoSource, /consumedUndoIds\.current\.add/);
  assert.match(undoSource, /inFlightUndoIds\.current\.has/);
  assert.match(undoSource, /inFlightUndoIds\.current\.add/);
  assert.match(undoSource, /inFlightUndoIds\.current\.delete/);
  assert.ok(
    undoSource.indexOf("await undoHandler") <
      undoSource.indexOf("consumedUndoIds.current.add"),
    "the undo must only be consumed after its mutation succeeds",
  );
  assert.match(
    undoSource,
    /toast\.error\("Undo failed\. Please try again\."\)/,
  );
  assert.match(undoSource, /isUndoWindowExpired\(pendingUndo, Date\.now\(\)\)/);
  assert.match(
    undoSource,
    /if \(inFlightUndoIds\.current\.has\(undoId\)\) return;/,
  );
  assert.match(undoSource, /consumedUndoIds\.current\.delete\(undoId\)/);
  assert.match(
    undoSource,
    /expiresAt: Date\.now\(\) \+ undoWindowMs/,
  );
  // The visible UNDO button is honoured for as long as it is on screen; only
  // the affordance-free Ctrl+Z path is bounded by the action window (HTPR-5528).
  assert.match(
    undoSource,
    /if \(!canRunUndo\(pendingUndoData, source, Date\.now\(\)\)\)/,
  );
  assert.match(undoSource, /source: UndoTrigger = "toast"/);
  assert.match(
    undoSource,
    /pendingUndo\.undoHandler\(pendingUndo, pendingUndo\.toastId, "shortcut"\)/,
  );
  assert.match(undoSource, /toast\.dismiss\(toastId\)/);
  assert.match(undoSource, /scheduleExpiry\(undoId, pendingUndoData\.expiresAt\)/);
  assert.match(undoSource, /setTimeout\(\(\) =>/);
  assert.match(shortcutsSource, /Undo latest action/);
  assert.match(commandsSource, /commandMode: CommandMode\.UndoLatest/);
  assert.match(commandHandlerSource, /case CommandMode\.UndoLatest:/);
});

test("the undo prompt stays on screen for the whole undo action window", () => {
  const toastSource = read("src/components/undoToast/index.tsx");
  const undoSource = read("src/hooks/General/useUndo.tsx");
  // Per viewport (HTPR-5872): mobile halves both the window and the toast
  // duration together; desktop keeps 15s.
  assert.match(toastSource, /UNDO_ACTION_WINDOW_MS = 15_000/);
  assert.match(toastSource, /MOBILE_UNDO_ACTION_WINDOW_MS = 7_500/);
  assert.match(
    toastSource,
    /UNDO_TOAST_DURATION_MS = UNDO_ACTION_WINDOW_MS/,
  );
  assert.match(
    toastSource,
    /MOBILE_UNDO_TOAST_DURATION_MS = MOBILE_UNDO_ACTION_WINDOW_MS/,
  );
  assert.match(
    toastSource,
    /duration: isMobile\s*\?\s*MOBILE_UNDO_TOAST_DURATION_MS\s*:\s*UNDO_TOAST_DURATION_MS/,
  );
  assert.match(
    undoSource,
    /const undoWindowMs = isMobile\s*\?\s*MOBILE_UNDO_ACTION_WINDOW_MS\s*:\s*UNDO_ACTION_WINDOW_MS/,
  );
  assert.match(
    undoSource,
    /expiresAt: Date\.now\(\) \+ undoWindowMs/,
  );
});
