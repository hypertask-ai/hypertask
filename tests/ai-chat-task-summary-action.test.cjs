const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/ai-chat-task-summary-action.test.cjs"),
  { interopDefault: true }
);
const { TASK_SUMMARY_ACTION, taskSummaryActionFor } = jiti(
  path.join(root, "src/components/AI_CHAT/taskSummaryAction.ts")
);

test("promotes the readable task summary action only with task context", () => {
  assert.equal(taskSummaryActionFor(), null);
  assert.equal(taskSummaryActionFor(null), null);
  assert.equal(taskSummaryActionFor(0), null);
  assert.deepEqual(taskSummaryActionFor(5404), TASK_SUMMARY_ACTION);
  assert.deepEqual(TASK_SUMMARY_ACTION, {
    label: "Summarize the current task",
    prompt: "/i Summarize the current task",
  });
});

test("the task welcome screen sends the promoted action prompt", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/AI_CHAT/WelcomeScreen.tsx"),
    "utf8"
  );
  const taskBranch = source.slice(
    source.indexOf("if (taskId)"),
    source.indexOf("if (boardBuild)")
  );

  assert.match(taskBranch, /taskSummaryAction\.label/);
  assert.match(
    taskBranch,
    /handleSendMessage\(taskSummaryAction\.prompt\)/
  );
});
