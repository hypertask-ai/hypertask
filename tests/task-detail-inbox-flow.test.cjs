const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
const {
  isInternalTaskDetailHref,
  preserveInboxFlowOnTaskHref,
  resolveCommentEnterShortcutAction,
} = jiti(path.join(root, "src/lib/taskDetailInboxFlow.ts"));
const { inboxConfig } = jiti(
  path.join(root, "src/lib/configs/inbox.config.ts"),
);

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Inbox lineage is added to canonical task URLs without losing query or hash", () => {
  assert.equal(
    preserveInboxFlowOnTaskHref(
      "/detail/project-15/5913?reply=true#comment-1",
      "true",
    ),
    "/detail/project-15/5913?reply=true&inboxFlow=true#comment-1",
  );
  assert.equal(
    preserveInboxFlowOnTaskHref(
      "https://app.hypertask.ai/detail/project-15/5913?audio=true#comment-2",
      "true",
    ),
    "https://app.hypertask.ai/detail/project-15/5913?audio=true&inboxFlow=true#comment-2",
  );
});

test("Inbox lineage propagation is idempotent and limited to internal task details", () => {
  const alreadyMarked =
    "/detail/project-15/5913?inboxFlow=true&reply=true#comment-1";
  assert.equal(
    preserveInboxFlowOnTaskHref(alreadyMarked, "true"),
    alreadyMarked,
  );
  assert.equal(
    preserveInboxFlowOnTaskHref("/detail/project-15/5913", null),
    "/detail/project-15/5913",
  );
  assert.equal(
    preserveInboxFlowOnTaskHref("/calendar", "true"),
    "/calendar",
  );
  assert.equal(
    preserveInboxFlowOnTaskHref(
      "https://example.com/detail/project-15/5913?reply=true#comment-1",
      "true",
    ),
    "https://example.com/detail/project-15/5913?reply=true#comment-1",
  );
  assert.equal(preserveInboxFlowOnTaskHref("not a URL", "true"), "not a URL");
});

test("only canonical internal task-detail URLs use app navigation", () => {
  const safeRootRelativeHref = "/detail/project-15/5913?reply=true#comment-1";
  assert.equal(isInternalTaskDetailHref(safeRootRelativeHref), true);
  assert.equal(
    preserveInboxFlowOnTaskHref(safeRootRelativeHref, "true"),
    "/detail/project-15/5913?reply=true&inboxFlow=true#comment-1",
  );
  assert.equal(
    isInternalTaskDetailHref(
      "https://app.hypertask.ai/detail/project-15/5913?reply=true#comment-1",
    ),
    true,
  );
  assert.equal(isInternalTaskDetailHref("/detail/project-x/5913"), false);
  assert.equal(
    isInternalTaskDetailHref(
      "https://app.hypertask.ai.evil.example/detail/project-15/5913",
    ),
    false,
  );
  assert.equal(
    isInternalTaskDetailHref(
      "https://evil.example/path/app.hypertask.ai/detail/project-15/5913",
    ),
    false,
  );
  assert.equal(
    isInternalTaskDetailHref(
      "https://app.hypertask.ai@evil.example/detail/project-15/5913",
    ),
    false,
  );
  for (const malformedHref of [
    "/\\evil.example/detail/project-1/2",
    "//evil.example/detail/project-1/2",
  ]) {
    assert.equal(isInternalTaskDetailHref(malformedHref), false);
    assert.equal(
      preserveInboxFlowOnTaskHref(malformedHref, "true"),
      malformedHref,
    );
  }
});

test("comment Enter shortcut modifiers resolve to one action", () => {
  const base = {
    commandKey: true,
    key: "Enter",
    shiftKey: false,
    altKey: false,
    isInboxFlow: true,
    isCommentMode: true,
    inInbox: true,
  };
  const cases = [
    { name: "ordinary send", changes: {}, expected: "send" },
    {
      name: "Inbox send and stay",
      changes: { shiftKey: true, inInbox: false },
      expected: "send-and-stay",
    },
    {
      name: "non-Inbox shifted Enter",
      changes: { shiftKey: true, isInboxFlow: false },
      expected: "ignore",
    },
    {
      name: "shifted description save in Inbox",
      changes: { shiftKey: true, isCommentMode: false },
      expected: "send",
    },
    {
      name: "Inbox send and complete",
      changes: { shiftKey: true, altKey: true },
      expected: "send-and-complete",
    },
    {
      name: "shifted complete without a notification",
      changes: { shiftKey: true, altKey: true, inInbox: false },
      expected: "consume",
    },
    {
      name: "shifted description save with Alt",
      changes: { shiftKey: true, altKey: true, isCommentMode: false },
      expected: "send",
    },
    {
      name: "missing command modifier",
      changes: { commandKey: false },
      expected: null,
    },
    { name: "different key", changes: { key: "A" }, expected: null },
  ];

  for (const { name, changes, expected } of cases) {
    assert.equal(
      resolveCommentEnterShortcutAction({ ...base, ...changes }),
      expected,
      name,
    );
  }
});

test("all nested task links apply the Inbox marker to their navigation target", () => {
  const exactIntegrations = [
    {
      file: "src/components/RTE/TipTapTaskDetail.tsx",
      pattern:
        /if \(href && isInternalTaskDetailHref\(href\)\)[\s\S]*?router\.push\(preserveInboxFlowOnTaskHref\(href, inboxFlow\)\)/,
    },
    {
      file: "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/InnerHTMLComment.tsx",
      pattern:
        /if \(href && isInternalTaskDetailHref\(href\)\)[\s\S]*?router\.push\(preserveInboxFlowOnTaskHref\(href, inboxFlow\)\)/,
    },
    {
      file: "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription.tsx",
      pattern:
        /if \(href && isInternalTaskDetailHref\(href\)\)[\s\S]*?router\.push\(preserveInboxFlowOnTaskHref\(href, inboxFlow\)\)/,
    },
    {
      file: "src/components/PageComponents/TaskDetail/TopRow/SubtaskLink.tsx",
      pattern: /href=\{preserveInboxFlowOnTaskHref\([\s\S]*?inboxFlow,[\s\S]*?\)\}/,
    },
    {
      file: "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptionSubTasks/DescriptionSubTasks.tsx",
      pattern: /href=\{preserveInboxFlowOnTaskHref\([\s\S]*?inboxFlow,[\s\S]*?\)\}/,
    },
    {
      file: "src/components/PageComponents/TaskDetail/TaskInfoColumn/RelatedTaskLabel.tsx",
      pattern:
        /const taskRoute = preserveInboxFlowOnTaskHref\(route, inboxFlow\);[\s\S]*?router\.push\(taskRoute\);[\s\S]*?href=\{taskRoute\}/,
    },
  ];

  for (const { file, pattern } of exactIntegrations) {
    assert.match(read(file), pattern, `${file} must navigate to the marked URL`);
  }
});

test("Inbox entry generates a marked initial task URL", () => {
  assert.equal(
    inboxConfig.urls.taskDetail(15, 5913),
    "/detail/project-15/5913?inboxFlow=true",
  );
  assert.equal(
    inboxConfig.urls.taskDetail(15, 5913, "#comment-210855"),
    "/detail/project-15/5913?inboxFlow=true#comment-210855",
  );
});
