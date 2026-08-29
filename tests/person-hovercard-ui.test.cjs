const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("person hovercard is interactive, keyboard reachable, and viewport safe", () => {
  const source = read("src/components/Common/PersonHovercard.tsx");

  assert.match(source, /safePolygon/);
  assert.match(source, /useFocus/);
  assert.match(source, /useDismiss/);
  assert.match(source, /onFloatingFocusEnter/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /flip\(\{ padding: 12 \}\)/);
  assert.match(source, /shift\(\{ padding: 12 \}\)/);
  assert.match(source, /role: "dialog"/);
  assert.match(source, /profile\?\.kind === "user" \? profile\.email/);
  assert.match(source, /navigator\.clipboard\.writeText\(email\)/);
  assert.match(source, /email &&/);
  assert.match(source, /agentPageHref\(profile\)/);
  assert.match(source, /href=\{profileHref\}/);
  assert.match(source, /Open \$\{profile\.displayName\} agent page/);
});

test("rich text hovercards accept only canonical person mention labels", () => {
  const source = read("src/components/Common/RichTextPersonHovercards.tsx");

  assert.match(source, /\^name-\(\[1-9\]\\d\*\)\$/);
  assert.match(source, /\^agent-\(\[0-9a-f\]\{8\}/);
  assert.match(source, /mention\.tabIndex = 0/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /!current\.element\.isConnected/);
  assert.match(source, /attributeFilter: \["data-label"\]/);
  assert.match(source, /identityChanged/);
  assert.match(source, /mention\.removeAttribute\("tabindex"\)/);
  assert.match(source, /onFloatingFocusEnter=\{cancelClose\}/);
});

test("task people and persisted mentions share the hovercard", () => {
  const createdBy = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/Common/CreatedBy.tsx",
  );
  const commentAuthor = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentCreatedBy.tsx",
  );
  const assignees = read(
    "src/components/PageComponents/TaskDetail/MainPageComponents/index.tsx",
  );
  const richTextScope = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/index.tsx",
  );

  assert.match(createdBy, /<ParentPersonHovercard projectId=\{projectId\} subject=\{subject\}/);
  assert.match(commentAuthor, /comment\.agent[\s\S]*comment\.creator/);
  assert.match(assignees, /<ParentPersonHovercard projectId=\{projectId\} subject=\{subject\}/);
  assert.match(richTextScope, /<RichTextPersonHovercards/);
});
