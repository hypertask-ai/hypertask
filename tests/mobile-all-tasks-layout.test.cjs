const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const allTasks = read("src/app/all-tasks/AllTasks.tsx");
const taskListRow = read(
  "src/components/Common/TaskRowComponents/TaskListRow.tsx",
);
const flags = read("src/lib/flags.ts");
const allTasksSource = ts.createSourceFile(
  "AllTasks.tsx",
  allTasks,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const jsxElements = [];
const collectJsxElements = (node) => {
  if (ts.isJsxElement(node)) jsxElements.push(node);
  ts.forEachChild(node, collectJsxElements);
};
collectJsxElements(allTasksSource);

const attributeNamed = (element, name) =>
  element.openingElement.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(allTasksSource) === name,
  );

const attributeText = (element, name) => {
  const initializer = attributeNamed(element, name)?.initializer;
  if (!initializer) return "";
  if (ts.isStringLiteral(initializer)) return initializer.text;
  return initializer.getText(allTasksSource);
};

const guardedBy = (node, condition) => {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (
      ts.isBinaryExpression(ancestor) &&
      ancestor.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      ancestor.left.getText(allTasksSource) === condition
    ) {
      return true;
    }
  }
  return false;
};

const mobileTabButton = jsxElements.find(
  (element) =>
    element.openingElement.tagName.getText(allTasksSource) === "button" &&
    attributeText(element, "key").includes("mobile-split-alltasks-"),
);
const legacyFooter = jsxElements.find(
  (element) =>
    element.openingElement.tagName.getText(allTasksSource) === "div" &&
    attributeText(element, "className").includes("inbox_footer"),
);

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
  assert.ok(mobileTabButton, "expected the redesigned mobile tab button");
  assert.equal(guardedBy(mobileTabButton, "mobileRedesignEnabled"), true);
  assert.ok(legacyFooter, "expected the legacy mobile tab footer");
  assert.equal(guardedBy(legacyFooter, "!mobileRedesignEnabled"), true);
});

test("the redesigned project tabs are inline, scrollable, and selectable", () => {
  assert.ok(mobileTabButton);
  const pressed = attributeNamed(mobileTabButton, "aria-pressed")?.initializer;
  const onClick = attributeNamed(mobileTabButton, "onClick")?.initializer;
  assert.ok(pressed && ts.isJsxExpression(pressed));
  assert.ok(onClick && ts.isJsxExpression(onClick));
  assert.equal(pressed.expression?.getText(allTasksSource), "activeSplit === index");
  assert.equal(
    onClick.expression?.getText(allTasksSource),
    "() => updateSplitAndTasks(index)",
  );
  assert.match(attributeText(mobileTabButton, "className"), /MOBILE_TARGET/);

  let tabBar;
  for (
    let ancestor = mobileTabButton.parent;
    ancestor;
    ancestor = ancestor.parent
  ) {
    if (
      ts.isJsxElement(ancestor) &&
      ancestor.openingElement.tagName.getText(allTasksSource) === "div" &&
      attributeText(ancestor, "className").includes("overflow-x-auto")
    ) {
      tabBar = ancestor;
      break;
    }
  }
  assert.ok(tabBar, "expected an inline scrolling tab container");
  assert.match(
    attributeText(tabBar, "className"),
    /border-b border-border-light-gray-thin pb-2 @md:hidden/,
  );
  assert.match(allTasks, /activeSplit === 0/);
  assert.match(
    allTasks,
    /mobileRedesignEnabled \? "mt-1 @md:mt-3" : "mt-3"/,
  );
});

test("native project-tab keyboard activation wins over task shortcuts", () => {
  const buttonGuard = allTasks.indexOf('activeTag === "BUTTON"');
  const controlReturn = allTasks.indexOf(
    '(inFormControl && activeTag !== "SELECT")',
  );
  const taskEnterShortcut = allTasks.indexOf(
    "event.keyCode === KeyCodes.ENTER",
    controlReturn,
  );
  assert.notEqual(buttonGuard, -1);
  assert.ok(buttonGuard < controlReturn);
  assert.ok(controlReturn < taskEnterShortcut);
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
