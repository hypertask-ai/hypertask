const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const homepage = read(
  "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx",
);
const section = read(
  "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
);
const placeholder = read(
  "src/components/PageComponents/Kanban/KanbanTaskComponents/ProgressiveTaskPlaceholder.tsx",
);
const task = read(
  "src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx",
);

test("large boards progressively mount cards near the viewport", () => {
  assert.match(section, /LARGE_BOARD_PROGRESSIVE_RENDER_THRESHOLD = 40/);
  assert.match(section, /new IntersectionObserver/);
  assert.match(section, /void loadTask\(\)\s*\.then/);
  assert.match(
    section,
    /isDragDisabled={!taskModuleReady \|\| dragDisabled}/,
  );
  assert.match(section, /setTimeout\(\(\) => preloadTask\(1\), 1_500\)/);
  assert.match(section, /setTaskModuleFailed\(true\)/);
  assert.match(section, /typeof IntersectionObserver === "undefined"/);
  assert.match(section, /getProgressiveTaskRenderMode/);
  assert.match(section, /PROGRESSIVE_REVEAL_SETTLE_MS = 160/);
  assert.match(section, /clearTimeout\(revealTimer\.current\)/);
  assert.match(section, /entry\.isIntersecting/);
  assert.match(section, /intersectingTaskIds\.current\.delete\(taskId\)/);
  assert.match(section, /rootMargin: "240px 160px"/);
  assert.match(section, /data-progressive-task-id/);
  assert.match(section, /revealedTaskIds\.has\(task\.id\)/);
  assert.match(section, /task\.id === activeItem/);
  assert.match(section, /mobileSectionNearViewport/);
  assert.match(section, /\.closest<HTMLElement>\(\s*"\.homepage-container-tag"/);
  assert.match(section, /getMobileSectionObserverOptions\(horizontalScroller\)/);
  assert.match(section, /shouldWarmInitialTasks &&\s*i < INITIAL_PROGRESSIVE_TASKS_PER_SECTION/);
  assert.match(
    section,
    /renderAllTasks \|\|\s*!shouldWarmInitialTasks/,
  );
  assert.match(section, /renderMode === "skeleton"/);
  assert.match(section, /renderMode === "placeholder"/);
});

test("progressive placeholders preserve navigation and focus identity", () => {
  assert.match(placeholder, /id={`task-\$\{task\.id\}`}/);
  assert.match(
    placeholder,
    /href={`\/detail\/project-\$\{task\.projectId\}\/\$\{task\.uniqueIndex\}`}/,
  );
  assert.match(placeholder, /aria-label={task\.title}/);
  assert.match(placeholder, /tabIndex={keyboardAccessible \? 0 : -1}/);
  assert.match(placeholder, /event\.key !== " "/);
  assert.match(section, /keyboardAccessible={taskModuleFailed}/);
  assert.match(placeholder, /matches\(":focus-visible"\)/);
  assert.match(placeholder, /onReveal\(task\.id, true\)/);
  assert.match(placeholder, /onOpen\(task\)/);
  assert.match(section, /setTasksPlayList\(tasksPlayList\)/);
  assert.match(section, /navigateToTask\(task\.projectId, task\.uniqueIndex\)/);
  assert.match(section, /pendingFocusTaskId/);
  assert.match(section, /new MutationObserver/);
  assert.doesNotMatch(section, /attempts < 10/);
});

test("drag capture mounts every card before dimensions are collected", () => {
  assert.match(section, /draggableId={`task-\$\{task\.id\}`}/);
  assert.match(section, /dragProvided={provided}/);
  assert.match(placeholder, /provided\.innerRef/);
  assert.match(placeholder, /provided\.draggableProps/);
  assert.match(task, /dragProvided \? \(/);
  assert.match(homepage, /onBeforeCapture={handleBeforeCapture}/);
  assert.match(homepage, /wraps this responder in ReactDOM\.flushSync/);
  assert.match(homepage, /draggableId\.startsWith\("task-"\)/);
  assert.match(homepage, /setRenderAllTasks\(true\)/);
  assert.match(homepage, /setRenderAllTasks\(false\)/);
  assert.match(section, /renderAllTasks \|\|/);
});
