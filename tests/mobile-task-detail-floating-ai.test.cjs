const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const commentComposer = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx",
  ),
  "utf8",
);

test("mobile task detail removes the composer-anchored button rail", () => {
  assert.doesNotMatch(commentComposer, /const ScrollToTop\s*=/);
  assert.doesNotMatch(commentComposer, /const PlaylistArrow\s*=/);
  assert.doesNotMatch(commentComposer, /const GoBackButton\s*=/);
  assert.doesNotMatch(commentComposer, /absolute[^"`]*-top-\[/);
});

test("mobile task detail keeps Ask AI outside the composer in the shared floating action", () => {
  assert.match(
    commentComposer,
    /\{_mbl && <AskAiButton\/>\}[\s\S]*?New Comment/,
  );
  assert.match(commentComposer, /MobileFloatingActionButton/);
  assert.match(commentComposer, /ariaLabel="Ask AI about this task"/);
  assert.match(commentComposer, /label="Ask AI"/);
  assert.match(commentComposer, /onClick=\{openAIChatInterface\}/);
});
