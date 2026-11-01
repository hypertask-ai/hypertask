const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const directory = "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/";
const MobileViewContext = React.createContext(false);
const styles = { hellow: "hellow", editorContainer: "editorContainer", readOnlyDescription: "readOnlyDescription", unstacked: "unstacked" };
const spacing = { mobile: { descriptionContainer: "xs:py-2 xs:px-[10px]" } };
const empty = () => null;
let context;
const mocks = {
  "next/navigation": {},
  "next/dynamic": { default: () => empty },
  "lucide-react": { X: empty },
  "@/styles/tiptap.module.scss": { default: styles },
  "@/styles/FileDragAndDrop.module.scss": { default: { container: "drag-container" } },
  "@/lib/configs/taskDetail.config": { taskDetailSpacing: spacing },
  "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  "@/lib/taskDetailInboxFlow": {},
  "./staticDescriptionHtml": { toEditorHtml: html => html },
  "@/utils/helperFunctions/sanitizeHtml": { sanitizeDescriptionHtml: html => html },
  "@/lib/contexts/mobileContext": { MobileViewContext },
  "@/lib/contexts/TaskDetail/TiptapProvider": { default: ({ children }) => children, useTiptapGlobalContext: () => context },
  "@/hooks/useFlag": { useFlag: () => false },
  "@/lib/flags/definitions/htpr-8173-description-inline-drafts": { HTPR_8173_DESCRIPTION_INLINE_DRAFTS_FLAG: "htpr-8173-description-inline-drafts" },
  "@/lib/flags/keys": {},
  "@/lib/state": { useRecoilValue: () => false, useSetRecoilState: () => empty },
  "@/store": {},
  "@/models/enums": {},
  "@tiptap/react": { EditorContent: () => React.createElement("div", { className: "" }, React.createElement("div", { className: "tiptap ProseMirror", contentEditable: false }, "Description")) },
  "./CreatedInfoTiptap": { default: empty },
  "./DragHandleTiptap": { default: empty },
  "./InlineDraftAiFloat": { default: empty },
  "@/components/Common/AttachmentsUpload": { default: empty },
  "@/components/Common/FileDragAndDrop": { default: ({ children }) => React.createElement("div", { className: "drag-container" }, children) },
  "../PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/StaticDescriptionPlaceholder": { StaticDescriptionPlaceholderContext: React.createContext(null) },
  "./Components/TiptapBubbleMenu": { default: empty },
  "../PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription": { default: empty },
  "../PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer": {},
  "./Components/EmojiGifPicker": { default: empty },
};
function load(relative) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => name in mocks ? { __esModule: true, ...mocks[name] } : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const { StaticDescriptionFrame } = load(`${directory}StaticDescriptionShell.tsx`);
mocks["./TiptapEditor"] = load("src/components/RTE/Components/TiptapEditor.tsx");
mocks["./Components/TiptapMainContainer"] = load("src/components/RTE/Components/TiptapMainContainer.tsx");
const { TaskDetailEditorPanels } = load("src/components/RTE/TaskDetailEditorPanels.tsx");

function chain(document) {
  const boxes = [];
  let node = document.querySelector(".ProseMirror");
  assert.ok(node);
  while (node) {
    boxes.push({
      id: node.id,
      classes: [...new Set(node.className.split(/\s+/).filter(value => /^(?:w-|min-[wh]-|max-w-|p[xytrbl]?-|mt-|@(?:sm|md):max-|col-|flex(?:$|-)|items-|relative$|drag-container|hellow|editorContainer|readOnlyDescription|unstacked)/.test(value)))].sort(),
      borderLeftWidth: node.style.borderLeftWidth,
      containerType: node.style.containerType,
    });
    if (node.id === "main-wrapper-description") return boxes;
    node = node.parentElement;
  }
  assert.fail("description frame is missing");
}

for (const isMbl of [true, false]) {
  test(`static ${isMbl ? "phone" : "desktop"} box chain matches the live read-only editor`, () => {
    context = { mode: "read-edit-description", id: "description", isMbl, editor: { isEmpty: false },
      divIds: { wrapperId: "main-wrapper-description", popoverContainer: "popover-wrapper-description", popoverTriggerButtonId: "popover-button-description" },
      currentTask: { id: 1 }, inViewObject: { taskProjectId: 15 }, newCommentAttachments: [] };
    const render = element => new JSDOM(renderToStaticMarkup(React.createElement(MobileViewContext.Provider, { value: isMbl }, element)));
    const first = render(React.createElement(StaticDescriptionFrame, { html: "<p>Description</p>", isMbl }));
    const live = render(React.createElement(TaskDetailEditorPanels, context));
    try {
      assert.deepEqual(chain(first.window.document), chain(live.window.document));
      assert.deepEqual(chain(first.window.document).map(box => box.id), isMbl
        ? ["", "", "description-input", "description", "main-wrapper-description"]
        : ["", "", "description-input", "", "description", "main-wrapper-description"]);
      assert.equal(first.window.document.querySelector("#main-wrapper-description").classList.contains("xs:px-[10px]"), isMbl);
    } finally { first.window.close(); live.window.close(); }
  });
}

