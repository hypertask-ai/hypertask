const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const comments = read(
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx",
);
const attachmentView = read("src/components/Common/AttachmentsView/index.tsx");
const attachmentStyles = read("src/styles/AttachmentView.scss");
const graphite = read("src/styles/tailwindThemes/graphite.css");
const themes = ["amoled", "dia", "graphite", "porcelain"].map((theme) =>
  read(`src/styles/tailwindThemes/${theme}.css`),
);

test("selected desktop comments keep their surface behind transparent attachments", () => {
  assert.match(
    comments,
    /isStacked \|\| comment\.activity\s*\? ""\s*:\s*" shadow-md bg-comment-description "/,
  );
  assert.match(
    graphite,
    /\.graphite \.main-attachment-container\s*\{[\s\S]*?background:\s*transparent;/,
  );
});

test("attachment thumbnails use comment surface tokens in every theme", () => {
  const tiles = attachmentView.match(/className="attachment-tile [^"]+"/g) ?? [];
  assert.equal(tiles.length, 2);
  for (const tile of tiles) {
    assert.match(tile, /border-comment-description-border/);
    assert.match(tile, /bg-comment-description/);
    assert.match(tile, /hover:bg-hoverCardBackground/);
  }
  assert.doesNotMatch(attachmentView, /bg-\[#27292D\]|bg-secondary/);
  for (const theme of themes) {
    assert.doesNotMatch(theme, /\.attachment-tile(?:-name)?(?:\:hover)?\s*\{/);
  }
});

test("attachment thumbnails opt out of nested comment card chrome", () => {
  assert.match(
    attachmentStyles,
    /\.attachment-tile\.bg-comment-description\s*\{[\s\S]*?border:\s*1px solid var\(--color-border-comment-description\) !important;[\s\S]*?box-shadow:\s*none !important;/,
  );
  assert.match(
    attachmentStyles,
    /> \.bg-comment-description\s*\{[\s\S]*?border:\s*0 !important;[\s\S]*?box-shadow:\s*none !important;/,
  );
});
