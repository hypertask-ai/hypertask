const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const comments = read(
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx",
);
const porcelain = read("src/styles/tailwindThemes/porcelain.css");

test("desktop posted comment cards are separated, excluding collapsed and activity rows", () => {
  assert.match(
    comments,
    /comment-container \$\{\s*!isStacked && !comment\.activity\s*\? "comment-separation-card"\s*:\s*""/,
  );
});

test("mobile posted comment bubbles always have separation", () => {
  assert.match(
    comments,
    /const commentBubble = \([\s\S]*?rounded-sm\s*\$\{styles\.hellow\}\s*comment-separation-card\s*\$\{/,
  );
  assert.match(comments, /return !comment\.activity \?/);
  assert.equal(comments.match(/comment-separation-card/g)?.length, 2);
});

test("Porcelain gives posted comments a visible hairline without changing layout", () => {
  const rule = porcelain.match(
    /\.porcelain \.comment-separation-card\s*\{(?<declarations>[\s\S]*?)\}/,
  );

  assert.ok(rule, "missing Porcelain comment card rule");
  assert.match(
    rule.groups.declarations,
    /outline:\s*1px solid var\(--border-light-gray-thin\)/,
  );
  assert.match(rule.groups.declarations, /outline-offset:\s*-1px/);
  assert.match(porcelain, /--border-light-gray-thin:\s*#e2e2e6/);
  assert.notEqual("#e2e2e6", "#f9f9fa");
  assert.notEqual("#e2e2e6", "#ffffff");
});
