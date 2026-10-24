const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const commentDir = "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/";
const flagKey = "htpr-7611-comment-parts-one-pass";
const suspendForever = () => { throw new Promise(() => {}); };

function compile(source, mocks) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", js)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

function renderComment(flagOn) {
  const comment = { id: 7, text: "<p>Long thread comment</p>" };
  const marker = (name) => () => React.createElement("span", { "data-part": name });
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/lib/contexts/CommentsContext": { useCommentsContext: () => ({ comment, i: 0, isStacked: false }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/styles/tiptap.module.scss": { __esModule: true, default: {} },
    "next/dynamic": { __esModule: true, default: () => suspendForever },
    "@/lib/state": { useRecoilValue: () => ({}), useRecoilState: () => [{ id: 985 }, () => {}] },
    "@/store": {},
    "@/models/enums": { CommandMode: {} },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ newCommentIds: [] }) },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({}) },
    "@/hooks/MultiPages/useDoubleTap": { useDoubleTap: () => ({}) },
    "@/lib/constants/TaskDetail": {},
    "lucide-react": { Reply: () => null },
    "@/hooks/useFlag": { useFlag: (key) => flagOn && key === flagKey },
    "@/lib/flags/keys": require("./helpers/flag-files.cjs").load("src/lib/flags/keys.ts"),
    "@/lib/flags/definitions/htpr-7724-blocker-comment": { HTPR_7724_BLOCKER_COMMENT_FLAG: "htpr-7724-blocker-comment" },
    "@/lib/taskDetailEditTarget": compile(read("src/lib/taskDetailEditTarget.ts"), {}),
    "@/lib/htc/isCommentCreatedByUser": { isCommentCreatedByUser: () => false },
    "@/components/Common/AttachmentsView": { __esModule: true, default: () => null },
    "./CommentBodyDesktop": { __esModule: true, default: ({ children }) => React.createElement("div", { "data-part": "body" }, children) },
    "./CommentCreatedBy": { __esModule: true, default: marker("author") },
    "./CommentText": { __esModule: true, default: marker("text") },
    "./CommentOptions": { CommentOptions: marker("options") },
    "./CommentOptions/ReplyToComment": { __esModule: true, default: () => null },
    "./SwipeableCommentRow": { __esModule: true, default: ({ children }) => children },
    "./CommentTaskActivity": { __esModule: true, default: () => null },
    "./CommentReactions": { __esModule: true, default: marker("reactions") },
  };
  const Comments = compile(read(`${commentDir}CommentsContainer.tsx`), mocks).default;
  return renderToString(React.createElement(Comments));
}

test("now refused: with the flag on, a comment no longer renders empty while its reactions code loads", () => {
  const html = renderComment(true);
  for (const part of ["body", "author", "text", "options", "reactions"]) assert.match(html, new RegExp(`data-part="${part}"`), part);
});

test("flag off keeps today's behaviour: the lazily loaded reactions hold the whole comment body back", () => {
  const html = renderComment(false);
  assert.doesNotMatch(html, /data-part="text"/);
  assert.match(html, /data-testid="ticket-comment"/);
});

test("emoji options follow the same flag in the comment toolbar", () => {
  const source = read(`${commentDir}CommentOptions.tsx`);
  assert.match(source, /import EmojiOptionsInOnePass from "\.\/EmojiOptionsComp";/);
  assert.match(source, /const EmojiOptionsComp = useFlag\(HTPR_7611_COMMENT_PARTS_ONE_PASS_FLAG\) \? EmojiOptionsInOnePass : EmojiOptionsLoadedLater;/);
});

test("flag ships as a bugfix on Everyone", () => {
  const definition = read("src/lib/flags/definitions/htpr-7611-comment-parts-one-pass.ts");
  assert.match(definition, /kind: "bugfix"/);
  assert.match(definition, /defaultMode: "EVERYONE"/);
});
