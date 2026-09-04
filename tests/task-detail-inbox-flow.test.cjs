const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  isInternalTaskDetailHref,
  preserveInboxFlowOnTaskHref,
  resolveCommentEnterShortcutAction,
  shouldFollowLinkNatively,
} = jiti(path.join(root, "src/lib/taskDetailInboxFlow.ts"));
const { inboxConfig } = jiti(
  path.join(root, "src/lib/configs/inbox.config.ts"),
);
const { getKeyboardShortcuts } = jiti(
  path.join(root, "src/lib/constants/shortcuts.ts"),
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

test("modified and non-primary link clicks keep native browser behavior", () => {
  const ordinary = {
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
  assert.equal(shouldFollowLinkNatively(ordinary), false);
  assert.equal(shouldFollowLinkNatively({ ...ordinary, altKey: true }), true);
  assert.equal(shouldFollowLinkNatively({ ...ordinary, ctrlKey: true }), true);
  assert.equal(shouldFollowLinkNatively({ ...ordinary, metaKey: true }), true);
  assert.equal(shouldFollowLinkNatively({ ...ordinary, shiftKey: true }), true);
  assert.equal(shouldFollowLinkNatively({ ...ordinary, button: 1 }), true);
});

test("comment Enter shortcut modifiers resolve to one action", () => {
  const base = {
    commandKey: true,
    key: "Enter",
    shiftKey: false,
    altKey: false,
    consistentCommentShortcuts: false,
    isInboxFlow: true,
    isCommentMode: true,
    inInbox: true,
  };
  const cases = [
    { name: "ordinary send", changes: {}, expected: "send" },
    {
      name: "consistent send and move outside Inbox",
      changes: {
        consistentCommentShortcuts: true,
        isInboxFlow: false,
        inInbox: false,
      },
      expected: "send-and-move",
    },
    {
      name: "consistent send and stay without Inbox lineage",
      changes: {
        consistentCommentShortcuts: true,
        shiftKey: true,
        isInboxFlow: false,
        inInbox: false,
      },
      expected: "send-and-stay",
    },
    {
      name: "consistent shortcuts leave Ctrl Alt Enter unchanged",
      changes: {
        consistentCommentShortcuts: true,
        altKey: true,
        isInboxFlow: false,
        inInbox: false,
      },
      expected: "send",
    },
    {
      name: "consistent shortcuts leave description saves unchanged",
      changes: {
        consistentCommentShortcuts: true,
        isCommentMode: false,
        isInboxFlow: false,
        inInbox: false,
      },
      expected: "send",
    },
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
      name: "Inbox send and complete remains unchanged by consistent shortcuts",
      changes: {
        consistentCommentShortcuts: true,
        shiftKey: true,
        altKey: true,
      },
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

test("comment shortcut discovery follows the owner-only flag", () => {
  const taskView = (enabled, isApple = false) =>
    getKeyboardShortcuts(isApple, false, enabled).find(
      (group) => group.title === "Task View",
    ).sub;

  assert.ok(
    taskView(false).some(
      (shortcut) => shortcut.shortTitle === "Save/edit text entry",
    ),
  );
  assert.ok(
    !taskView(false).some((shortcut) =>
      shortcut.shortTitle.startsWith("Send comment"),
    ),
  );
  assert.deepEqual(
    taskView(true).filter((shortcut) =>
      shortcut.shortTitle.startsWith("Send comment"),
    ),
    [
      {
        shortTitle: "Send comment and move to next task",
        pressKey: ["CTRL", "ENTER"],
      },
      {
        shortTitle: "Send comment and stay on task",
        pressKey: ["CTRL", "SHIFT", "ENTER"],
      },
    ],
  );
  assert.deepEqual(
    taskView(true, true).find(
      (shortcut) => shortcut.shortTitle === "Send comment and move to next task",
    ).pressKey,
    ["CMD", "ENTER"],
  );

  for (const file of [
    "src/components/sidebars/keyboardShortcuts.tsx",
    "src/components/Modals/Settings/ShortcutsSection.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /useFlag\(\s*"htpr-5913-consistent-comment-shortcuts"/);
    assert.match(
      source,
      /getKeyboardShortcuts\([\s\S]*?consistentCommentShortcuts/,
    );
  }

  const registry = read("docs/keyboard-shortcuts-registry.md");
  assert.match(registry, /`Mod\+ENTER` \| With the owner-only/);
  assert.match(registry, /`Mod\+Shift\+ENTER` \| With the same flag/);
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

test("Inbox task links seed the playlist before native navigation", () => {
  const source = read("src/components/notifications/inboxSplit/index.tsx");
  const taskLinkStart = source.indexOf(
    "<Link",
    source.indexOf('notification.type === "AgentMessage"'),
  );
  const taskLinkEnd = source.indexOf("</Link>", taskLinkStart);
  assert.ok(taskLinkStart >= 0 && taskLinkEnd > taskLinkStart);

  const taskLink = source.slice(taskLinkStart, taskLinkEnd);
  assert.match(
    taskLink,
    /onClick=\{\(\) =>[\s\S]*?notification\.type !== "Invited" &&[\s\S]*?setTasksPlayList\([\s\S]*?buildUniqueTasksPlaylist\(_notifications\)/,
  );
});
