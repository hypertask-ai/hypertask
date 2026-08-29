const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/figma-comment-preview.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { hasFigmaEmbed } = jiti(
  path.join(root, "src/utils/helperFunctions/hasFigmaEmbed.ts"),
);
const { isContentCarouselImage } = jiti(
  path.join(root, "src/utils/helperFunctions/isContentCarouselImage.ts"),
);

const source = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("detects stored Figma iframes on approved HTTPS hosts", () => {
  assert.equal(
    hasFigmaEmbed(
      '<p>Design</p><iframe src="https://www.figma.com/embed?url=https%3A%2F%2Fwww.figma.com%2Fdesign%2Fabc"></iframe>',
    ),
    true,
  );
  assert.equal(
    hasFigmaEmbed("<iframe title='Design' src='https://figma.com/embed?url=x'></iframe>"),
    true,
  );
});

test("does not opt ordinary or lookalike content into a full editor", () => {
  for (const html of [
    "<p>figma is mentioned as text</p>",
    '<img src="https://www.figma.com/preview.png">',
    '<iframe src="http://www.figma.com/embed?url=x"></iframe>',
    '<iframe src="https://figma.com.evil.example/embed?url=x"></iframe>',
    '<iframe src="not-a-url-figma"></iframe>',
    "<p>ordinary comment</p>",
    "",
    null,
  ]) {
    assert.equal(hasFigmaEmbed(html), false, String(html));
  }
});

test("excludes Figma control thumbnails from the content-image carousel", () => {
  assert.equal(
    isContentCarouselImage({ closest: () => ({ dataset: {} }) }),
    false,
  );
  assert.equal(isContentCarouselImage({ closest: () => null }), true);
});

test("Figma comments keep one editor while non-Figma comments stay lightweight", () => {
  const commentText = source(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentText.tsx",
  );
  const commentsContainer = source(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx",
  );
  const figmaBranch = commentText.indexOf("if (hasFigmaEmbed(comment.text))");
  const stackedBranch = commentText.indexOf("if (isCollapsed)");
  const ordinaryEditBranch = commentText.indexOf("if (isEditing)");

  assert.ok(figmaBranch >= 0, "missing Figma-specific render branch");
  assert.ok(
    figmaBranch < stackedBranch && figmaBranch < ordinaryEditBranch,
    "Figma selection must not switch renderers when editState changes",
  );
  assert.match(commentText, /data-persistent-figma-comment="true"/);
  assert.match(commentText, /key=\{`figma-editor-\$\{comment\.id\}`\}/);
  assert.match(commentText, /isCollapsed=\{isCollapsed\}/);
  assert.match(commentText, /allowEdit=\{isEditing\}/);
  assert.match(commentText, /defaultContent=\{comment\.text \?\? ""\}/);
  assert.doesNotMatch(commentText, /linkifyHtml/);
  assert.match(commentText, /carouselAttachments=\{comment\.attachments\}/);
  assert.match(commentText, /<InnerHTMLComment/);
  assert.doesNotMatch(commentText, /attachments=\{comment\.attachments\}/);
  assert.match(
    commentsContainer,
    /<CommentText \/>[\s\S]*comment\.attachments[\s\S]*<AttachmentView/,
    "the outer comment container must keep rendering standalone attachments",
  );
});

test("public shares keep Figma comments on the read-only renderer", () => {
  const sharedCommentContainer = source(
    "src/components/PageComponents/TaskDetail/SharedTask/CommentsAndDescription/Comments/CommentContainer.tsx",
  );
  const sharedCommentText = source(
    "src/components/PageComponents/TaskDetail/SharedTask/CommentsAndDescription/Comments/CommentText.tsx",
  );

  assert.match(
    sharedCommentContainer,
    /import SharedCommentText from "\.\/CommentText";/,
  );
  assert.doesNotMatch(
    sharedCommentContainer,
    /CommentAndDescription\/CommentContainer\/CommentText/,
  );
  assert.match(sharedCommentText, /<InnerHTMLComment/);
  assert.doesNotMatch(sharedCommentText, /TipTapTaskDetail|<Tiptap/);
});

test("the persistent read view is inert but keeps its existing interactions", () => {
  const taskEditor = source("src/components/RTE/TipTapTaskDetail.tsx");
  const tiptapEditor = source("src/components/RTE/Components/TiptapEditor.tsx");
  const editorContainer = source(
    "src/components/RTE/Components/TiptapMainContainer.tsx",
  );
  const figmaNode = source(
    "src/components/RTE/Extensions/FigmaTiptap/index.ts",
  );
  const taskDetail = source("src/app/detail/[...slug]/TaskDetailComp.tsx");

  assert.match(
    taskEditor,
    /mode === "read-edit-description" \|\| mode === "read-edit-comments"/,
  );
  assert.match(taskEditor, /isEditModeActive=\{allowEdit\}/);
  assert.match(taskEditor, /if \(isReadOnlyContent\) return;/);
  assert.match(taskEditor, /onClickCapture=\{handleReadOnlyContentClick\}/);
  assert.match(taskEditor, /target\.closest\("\[data-figma-embed-preview\]"\)/);
  assert.match(editorContainer, /!isEditModeActive &&/);
  assert.match(editorContainer, /!isReadOnlyExistingContent && \(/);
  assert.match(figmaNode, /preview\.dataset\.figmaEmbedPreview = 'true'/);
  assert.match(taskEditor, /\.filter\(isContentCarouselImage\)/);
  assert.match(
    taskEditor,
    /\.\.\.\(carouselAttachments \?\? attachments \?\? \[\]\)/,
  );
  assert.match(editorContainer, /\{isEditModeActive && \(/);
  assert.match(tiptapEditor, /id=\{`\$\{id\}-input`\}/);
  assert.match(
    taskDetail,
    /hasFigmaEmbed\(comment\.text\)[\s\S]*getElementById\(`comment-\$\{commentIndex\}-input`\)[\s\S]*getElementById\(`comment-\$\{comment\.id\}-input`\)/,
  );
});
