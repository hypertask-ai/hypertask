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
const flags = read("src/lib/flags.ts");
const flagKeys = read("src/lib/flags/keys.ts");
const porcelain = read("src/styles/tailwindThemes/porcelain.css");

test("Porcelain comment separation is declared as an Owner and QA feature flag", () => {
  assert.match(
    flagKeys,
    /HTPR_6554_LIGHT_COMMENT_SEPARATION_FLAG\s*=\s*"htpr-6554-light-comment-separation"/,
  );
  assert.match(
    flags,
    /key: HTPR_6554_LIGHT_COMMENT_SEPARATION_FLAG,[\s\S]*?description:\s*"Adds a quiet outline around posted comments in the Porcelain theme so adjacent comments stay distinct on phone and desktop\."/,
  );
});

test("the flag marks both mobile and desktop posted comment cards", () => {
  assert.match(
    comments,
    /useFlag\(\s*HTPR_6554_LIGHT_COMMENT_SEPARATION_FLAG,?\s*\)/,
  );
  assert.match(
    comments,
    /lightCommentSeparationEnabled && !isStacked && !comment\.activity/,
  );
  assert.equal(comments.match(/"comment-separation-card"/g)?.length, 2);
});

test("Porcelain gives enabled posted comments a visible hairline without changing layout", () => {
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
