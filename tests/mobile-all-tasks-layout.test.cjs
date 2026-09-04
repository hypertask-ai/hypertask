const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const allTasks = read("src/app/all-tasks/AllTasks.tsx");
const taskListRow = read(
  "src/components/Common/TaskRowComponents/TaskListRow.tsx",
);
const flags = read("src/lib/flags.ts");

test("All Tasks owns one mobile horizontal inset around its header and rows", () => {
  assert.match(allTasks, /className="px-4 @md:px-0"/);
  assert.match(
    allTasks,
    /className="flex items-center justify-between gap-5 @md:px-\[40px\]"/,
  );
  assert.match(allTasks, /rounded-b-\[4px\] px-0 @md:!px-16/);
  const taskRowTag = allTasks.match(/<TaskListRow\b([\s\S]*?)\/>/);
  assert.ok(taskRowTag, "All Tasks should render a TaskListRow");
  assert.match(taskRowTag[1], /\bflushMobilePadding\b/);
});

test("the mobile redesign is gated behind its declared feature flag", () => {
  assert.match(flags, /"htpr-5992-mobile-all-tasks"/);
  assert.match(
    allTasks,
    /useFlag\("htpr-5992-mobile-all-tasks"\)/,
  );
  assert.match(allTasks, /\{mobileRedesignEnabled && \(/);
  assert.match(allTasks, /\{!mobileRedesignEnabled && \(/);
});

test("the redesigned project tabs are inline, scrollable, and selectable", () => {
  assert.match(
    allTasks,
    /mobile-split-alltasks-[\s\S]*?aria-pressed=\{activeSplit === index\}[\s\S]*?updateSplitAndTasks\(index\)/,
  );
  assert.match(
    allTasks,
    /overflow-x-auto border-b border-border-light-gray-thin pb-2 @md:hidden/,
  );
  assert.match(allTasks, /activeSplit === 0/);
});

test("All Tasks opts into compact mobile rows without changing shared desktop rows", () => {
  const taskRowTag = allTasks.match(/<TaskListRow\b([\s\S]*?)\/>/);
  assert.ok(taskRowTag);
  assert.match(taskRowTag[1], /compactMobile=\{mobileRedesignEnabled\}/);
  assert.match(taskListRow, /compactMobile\?: boolean/);
  assert.match(
    taskListRow,
    /compactMobile && \([\s\S]*?@md:hidden[\s\S]*?task\.ticketNumber[\s\S]*?task\.title/,
  );
  assert.equal(
    [...taskListRow.matchAll(/compactMobile && "hidden @md:flex"/g)].length,
    3,
  );
});

test("mobile task rows shrink and truncate inside their content box", () => {
  assert.doesNotMatch(taskListRow, /(?:max-)?w-\[[^\]]*vw\]/);
  assert.doesNotMatch(taskListRow, /xs:flex-wrap|xs:whitespace-pre-wrap/);
  assert.match(taskListRow, /"flex min-w-0 flex-grow/);
  assert.match(taskListRow, /className="min-w-0 flex-1 flex-column/);
  assert.match(
    taskListRow,
    /className="flex min-w-0 items-center truncate justify-start gap-1/,
  );
  assert.match(
    taskListRow,
    /className="block w-full max-w-full truncate whitespace-nowrap line-clamp-1"/,
  );
});

test("task rows follow the global view container breakpoints", () => {
  assert.doesNotMatch(
    taskListRow,
    /(^|[^@\w-])(?:x-sm|xs|sm|md|lg|xl|2xl):/m,
  );
  assert.match(taskListRow, /@md:flex-row/);
  assert.match(taskListRow, /@md:hidden/);
});
