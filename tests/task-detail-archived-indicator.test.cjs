const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const indicator = read(
  "src/components/PageComponents/TaskDetail/TaskOptions/MarkTaskAsDone.tsx",
);
const taskOptions = read(
  "src/components/PageComponents/TaskDetail/TaskOptions/TaskOptions.tsx",
);
const archiveHook = read("src/hooks/Task Detail/useArchiveAndNavigate.ts");
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, { interopDefault: true });
const { getTaskDetailHeaderActions } = jiti(
  path.join(root, "src/lib/taskDetailArchiveActions.ts"),
);
const {
  getTaskArchiveAction,
  getTaskArchiveVisualState,
} = jiti(path.join(root, "src/lib/taskDetailArchiveControl.ts"));

test("task detail uses the shared completion control on mobile and desktop", () => {
  assert.equal(
    taskOptions.match(/<MarkTaskAsDone markAsDone=\{markAsDone\} \/>/g)?.length,
    2,
  );
  assert.match(
    indicator,
    /import \{ CircleCheck \} from "lucide-react"/,
  );
  assert.match(indicator, /<CircleCheck/);
  assert.doesNotMatch(indicator, /ArchiveRestore|<Archive/);
});

test("inbox task detail keeps the task-completion action beside notification removal", () => {
  assert.deepEqual(
    getTaskDetailHeaderActions({ hasNotifications: true, isMobile: false }),
    ["share", "remove-notification", "archive", "remind", "command"],
  );
});

test("mobile task detail keeps its existing two actions", () => {
  assert.deepEqual(
    getTaskDetailHeaderActions({ hasNotifications: true, isMobile: true }),
    ["share", "archive"],
  );
});

test("archive and unarchive use distinct semantic actions", () => {
  assert.deepEqual(getTaskArchiveAction("Normal"), {
    action: "archive",
    isArchived: false,
    label: "Archive this task",
  });
  assert.deepEqual(getTaskArchiveAction("Archive"), {
    action: "unarchive",
    isArchived: true,
    label: "Unarchive this task",
  });
});

test("an in-flight archive keeps the original action visible", () => {
  assert.deepEqual(getTaskArchiveVisualState("Archive", "archive"), {
    isArchived: false,
    label: "Archiving task",
  });
  assert.deepEqual(getTaskArchiveVisualState("Normal", "unarchive"), {
    isArchived: true,
    label: "Unarchiving task",
  });
});

test("keyboard and command archive paths do not flash the restore state", () => {
  const markAsDone = archiveHook.slice(
    archiveHook.indexOf("const markAsDone = async"),
    archiveHook.indexOf("const undoHandler"),
  );
  const mutationAt = markAsDone.indexOf("await removeFromListWithStatus(");
  const localStatusAt = markAsDone.indexOf("setCurrentTask((old)");

  assert.ok(mutationAt >= 0);
  assert.ok(localStatusAt > mutationAt);
  assert.match(markAsDone, /if \(isUnarchiving\) \{[\s\S]*status: "Normal"/);
  // The archived status is applied locally only when nothing navigated away.
  assert.match(
    markAsDone,
    /shouldApplyLocalArchivedStatus\(\{ isUnarchiving, navigationOutcome \}\)[\s\S]*status: "Archive"/,
  );
});

test("archiving a directly opened task leaves its stale detail page", () => {
  // No playlist to place the task in: the hook falls back to going back.
  assert.match(archiveHook, /: "back"/);
  assert.match(archiveHook, /if \(playlistTarget === "back"\) \{\s*onGoback\(\)/);
});

test("archive states use the static task-header completion treatment", () => {
  const archiveIcon = indicator.slice(
    indicator.indexOf("const archiveIcon"),
    indicator.indexOf("return("),
  );

  assert.match(indicator, /size=\{20\}/);
  assert.match(indicator, /strokeWidth=\{1\.75\}/);
  assert.match(indicator, /className=\{`keep-stroke task-option-icon /);
  assert.match(indicator, /text-\[#696b6e\]/);
  assert.match(indicator, /task-archived-indicator/);
  assert.match(indicator, /text-\[var\(--color-archived-state\)\]/);
  assert.match(
    indicator,
    /group-hover:text-\[var\(--color-archived-state\)\]/,
  );
  assert.doesNotMatch(archiveIcon, /\b(?:animate|transition)(?:-[\w-]+)?\b/);
  assert.equal(indicator.match(/aria-label=\{archiveLabel\}/g)?.length, 2);
  assert.equal(indicator.match(/aria-busy=\{!!pendingAction\}/g)?.length, 2);
  assert.equal(indicator.match(/disabled=\{!!pendingAction\}/g)?.length, 2);
  assert.doesNotMatch(indicator, /aria-pressed/);
  assert.equal(indicator.match(/id="markAsDone"/g)?.length, 2);
  assert.doesNotMatch(indicator, /tabIndex=\{-1\}/);
  assert.match(indicator, /focus-visible:ring-container-outline/);
  assert.match(
    indicator,
    /if \(event\.key === "Enter"\) event\.stopPropagation\(\)/,
  );
  assert.equal(
    indicator.match(/onKeyDown=\{stopArchiveEnterPropagation\}/g)?.length,
    2,
  );
});

test("archived-state contrast is theme-aware", () => {
  assert.match(
    read("src/styles/tailwindThemes/light.css"),
    /--color-archived-state: #166534/,
  );
  assert.match(
    read("src/styles/tailwindThemes/dark.css"),
    /--color-archived-state: #86efac/,
  );
  assert.match(
    read("src/styles/tailwindThemes/amoled.css"),
    /--color-archived-state: #4ade80/,
  );
  assert.match(
    read("src/styles/tailwindThemes/porcelain.css"),
    /--color-archived-state: #166534/,
  );
  assert.match(
    read("src/styles/tailwindThemes/graphite.css"),
    /--color-archived-state: #86efac/,
  );
  assert.match(
    read("src/styles/tailwindThemes/dia.css"),
    /--color-archived-state: #3e6b4f[\s\S]*?\.dia \.task-archived-indicator,[\s\S]*?\.dia \.task-archived-indicator:hover \{[\s\S]*?color: var\(--color-archived-state\)/,
  );
});
