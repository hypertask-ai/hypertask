const fs = require("./helpers/chat-stream-source.cjs");
const path = require("node:path");
const { readRefactoredSource } = require("../src/app/detail/[...slug]/taskDetailTestSources.cjs");

const root = path.resolve(__dirname, "..");
const modules = {
  "src/pages/api/tasks/createGlobally.ts": ["../../../lib/api/task-writes/create-global-effects.ts"],
  "src/pages/api/tasks/create.ts": ["../../../lib/api/task-writes/create-fullscreen.ts"],
  "src/components/commands.tsx": [
    "useCommandsState.ts", "boardCommandActions.ts", "commandDispatcher.ts",
    "generalCommandActions.ts", "commandModalCallbacks.ts", "commandModals.ts",
    "commandModalPanels1.tsx", "commandModalPanels2.tsx", "commandTypes.ts",
  ],
  "src/components/Modals/commands/HTC/AllCommands.ts": [
    "navigationCommands.ts", "taskCommands.ts",
  ],
  "src/components/PageComponents/Kanban/TableView/TableView.tsx": [
    "tableViewShared.tsx", "useTableState.ts", "useTableColumns.ts",
    "useTableRows.ts", "useTableActions.ts", "useTableKeyboard.ts", "TableTaskRow.tsx",
  ],
  "src/hooks/MultiPages/AIChat/useAiChat.ts": [
    "aiChatShared.ts", "useAiChatState.ts", "useAiChatSessions.ts",
    "aiChatKeyboard.ts", "useAiChatAttachments.ts", "aiChatSend.ts",
    "aiChatStream.ts", "useAiChatPresentation.ts",
  ],
  "src/app/[...boardURL]/LandingPage.tsx": [
    "LandingPageShared.ts", "LandingPageSection.tsx", "useLandingSectionState.ts",
  ],
  "src/app/api/ai/_lib/editorAi.ts": ["editorAiPrompts.ts"],
  "src/utils/helperFunctions/helperFunctions.ts": ["inboxHelpers.ts"],
  "src/components/Common/AttachmentsUpload/index.tsx": [
    "attachmentUploadTypes.ts", "useAttachmentUploadState.ts",
    "MobileAttachmentEdit.tsx", "AttachmentControls.tsx",
  ],
};

// Source contract tests inspect the implementation, including its moved modules.
/** @type {typeof import("node:fs").readFileSync} */
const readFileSync = (file, options) => {
  const contents = fs.readFileSync(file, options);
  if (typeof file !== "string" || typeof contents !== "string") return contents;
  const key = path.relative(root, path.resolve(file)).split(path.sep).join("/");
  if (key === "src/app/detail/[...slug]/TaskDetailComp.tsx" ||
      key === "src/components/RTE/TipTapTaskDetail.tsx") {
    return readRefactoredSource(file, options);
  }
  const siblings = modules[key];
  if (!siblings) return contents;
  const moved = siblings.map((sibling) =>
    fs.readFileSync(path.join(root, path.dirname(key), sibling), options)
  );
  return (key.endsWith("AttachmentsUpload/index.tsx")
    ? [contents, ...moved]
    : [...moved, contents]).join("\n");
};

function readFunctionSource(file, name) {
  const ts = require("typescript");
  const source = ts.createSourceFile(file, readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  return declaration?.getText(source);
}

module.exports = { ...fs, readFileSync, readFunctionSource };
