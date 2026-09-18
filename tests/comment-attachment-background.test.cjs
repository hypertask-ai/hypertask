const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const comments = read(
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx",
);
const graphite = read("src/styles/tailwindThemes/graphite.css");

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
