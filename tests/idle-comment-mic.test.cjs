// HTPR-6555. The closed mobile comment bar must show the existing AudioButton
// so dictation is one tap. A mic that only appears after the editor mounts is
// the QA fail this ticket already had.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const newComment = fs.readFileSync(
  path.join(
    __dirname,
    "../src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx",
  ),
  "utf8",
);

test("the idle mobile comment placeholder reuses AudioButton behind the ticket flag", () => {
  assert.match(newComment, /HTPR_6555_IDLE_COMMENT_MIC_FLAG/);
  assert.match(newComment, /from "@\/components\/RTE\/Components\/AudioButton"/);
  assert.match(newComment, /idleCommentMicEnabled \? \(/);
  assert.match(newComment, /showIdleMic/);

  const placeholder = newComment.slice(
    newComment.indexOf("const NewCommentPlaceholder"),
  );
  assert.match(placeholder, /id="create-comment-audio-button"/);
  assert.match(placeholder, /editor=\{null\}/);
  assert.match(placeholder, /event\.stopPropagation\(\)/);
  assert.match(placeholder, /ariaLabel="Start dictation"/);
});

test("idle dictation waits for the editor-ready callback instead of a one-second poll", () => {
  const dictationEffect = newComment.slice(
    newComment.indexOf("applyPendingIdleDictation"),
    newComment.indexOf("Track composer focus"),
  );
  assert.match(dictationEffect, /subscribeTiptapEditorReady/);
  assert.doesNotMatch(dictationEffect, /attempts < 40/);
  assert.doesNotMatch(dictationEffect, /setTimeout\(applyPending/);
  assert.match(dictationEffect, /pendingIdleDictationRef\.current = null/);

  const snippets = fs.readFileSync(
    path.join(__dirname, "../src/lib/snippets.ts"),
    "utf8",
  );
  assert.match(snippets, /export const subscribeTiptapEditorReady/);
  assert.match(
    snippets,
    /editorReadyListeners\.forEach\(\(listener\) => listener\(mode, editor\)\)/,
  );
});
