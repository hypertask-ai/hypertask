const fs = require("node:fs");
const path = require("node:path");

exports.readRefactoredSource = (filename, encoding = "utf8") => {
  const normalized = String(filename).replaceAll("\\", "/");
  if (normalized.endsWith("src/app/detail/[...slug]/TaskDetailComp.tsx")) {
    return exports.readTaskDetailSource();
  }
  if (normalized.endsWith("src/components/RTE/TipTapTaskDetail.tsx")) {
    return exports.readTipTapTaskDetailSource();
  }
  return fs.readFileSync(filename, encoding);
};

function readSources(directory, files) {
  return files.map((file) => fs.readFileSync(path.join(directory, file), "utf8")).join("\n");
}

exports.readTaskDetailSource = () => readSources(__dirname, [
  "TaskDetailComp.tsx",
  "useTaskDetailState.tsx",
  "useTaskDetailModals.tsx",
  "taskDetailKeyboard.ts",
  "taskDetailEditingKeymap.ts",
  "taskDetailNavigationKeymap.ts",
  "useTaskDetailNavigationActions.tsx",
  "useTaskDetailCommandActions.tsx",
  "useTaskDetailCommentActions.tsx",
  "useTaskDetailModalActions.tsx",
  "useTaskDetailInitialScroll.tsx",
  "useTaskDetailReadiness.tsx",
  "TaskDetailPanels.tsx",
]);

exports.readTipTapTaskDetailSource = () => readSources(path.resolve(__dirname, "../../../components/RTE"), [
  "TipTapTaskDetail.tsx",
  "useTaskDetailEditorState.tsx",
  "useTaskDetailEditorDrafts.tsx",
  "useTaskDetailEditorSave.tsx",
  "useTaskDetailEditorKeyboard.tsx",
  "useTaskDetailEditorWriter.tsx",
  "taskDetailEditorPresentation.tsx",
  "useTaskDetailEditorFocus.tsx",
  "useTaskDetailEditorEvents.tsx",
  "TaskDetailEditorPanels.tsx",
]);
