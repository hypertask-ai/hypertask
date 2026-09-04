const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

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
const { fetchFigmaOembed, renderFigmaPreview } = jiti(
  path.join(root, "src/components/RTE/Extensions/FigmaTiptap/index.ts"),
);
const { FIGMA_CONNECTION_VERSION_COOKIE } = jiti(
  path.join(root, "src/lib/figma/paths.ts"),
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

test("renders at most six returned Figma frames side by side", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const originalDocument = global.document;
  global.document = dom.window.document;
  try {
    const createdImages = [];
    const createElement = document.createElement.bind(document);
    document.createElement = (tagName, options) => {
      const element = createElement(tagName, options);
      if (tagName === "img") createdImages.push(element);
      return element;
    };
    const preview = document.createElement("button");
    const affordance = document.createElement("span");
    preview.append(affordance);
    renderFigmaPreview(preview, affordance, {
      previewImages: Array.from({ length: 7 }, (_, index) => ({
        name: `Frame ${index + 1}`,
        url: `https://s3-alpha.figma.com/frame-${index + 1}.png`,
      })),
    });

    assert.equal(preview.querySelectorAll("img").length, 0);
    createdImages[0].onload();
    let images = preview.querySelectorAll("img");
    assert.equal(images.length, 6);
    assert.equal(images[0].alt, "Frame 1");
    assert.equal(images[5].alt, "Frame 6");
    assert.match(images[0].className, /object-contain/);
    assert.equal(affordance.textContent, "Click to open the live file");
    createdImages[1].onerror();
    images = preview.querySelectorAll("img");
    assert.equal(images.length, 5);
  } finally {
    global.document = originalDocument;
  }
});

test("deduplicates only in-flight previews within one connection version", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://app.hypertask.ai/detail/project-15/6136",
  });
  const originalDocument = global.document;
  const originalFetch = global.fetch;
  global.document = dom.window.document;
  document.cookie = `${FIGMA_CONNECTION_VERSION_COOKIE}=connection-one; Path=/`;

  const responses = [];
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return new Promise((resolve) => responses.push(resolve));
  };

  try {
    const first = fetchFigmaOembed("https://www.figma.com/design/abc");
    const duplicate = fetchFigmaOembed("https://www.figma.com/design/abc");
    assert.equal(first, duplicate);
    assert.equal(fetchCalls, 1);

    responses.shift()(Response.json({ title: "First" }));
    assert.deepEqual(await first, { title: "First" });

    const settled = fetchFigmaOembed("https://www.figma.com/design/abc");
    assert.notEqual(settled, first);
    assert.equal(fetchCalls, 2);
    responses.shift()(Response.json({ title: "Second" }));
    assert.deepEqual(await settled, { title: "Second" });
  } finally {
    global.document = originalDocument;
    global.fetch = originalFetch;
  }
});

test("rejects an in-flight preview after the connection version changes", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://app.hypertask.ai/detail/project-15/6136",
  });
  const originalDocument = global.document;
  const originalFetch = global.fetch;
  global.document = dom.window.document;
  document.cookie = `${FIGMA_CONNECTION_VERSION_COOKIE}=connection-one; Path=/`;

  let resolveFetch;
  global.fetch = async () =>
    new Promise((resolve) => {
      resolveFetch = resolve;
    });

  try {
    const preview = fetchFigmaOembed("https://www.figma.com/design/stale");
    document.cookie = `${FIGMA_CONNECTION_VERSION_COOKIE}=connection-two; Path=/`;
    resolveFetch(Response.json({ title: "Stale" }));
    await assert.rejects(preview, /Figma connection changed/);
  } finally {
    global.document = originalDocument;
    global.fetch = originalFetch;
  }
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
  const figmaPaths = source("src/lib/figma/paths.ts");

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
  assert.match(figmaNode, /Connect Figma to preview/);
  assert.match(figmaNode, /FIGMA_OAUTH_START_PATH/);
  assert.match(figmaPaths, /\/api\/figma\/oauth\/start/);
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
