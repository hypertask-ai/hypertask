const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const taskInfoSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx",
  ),
  "utf8",
);
const sharedTaskInfoSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/TaskDetail/SharedTask/MainPage/TaskInfoColumn.tsx",
  ),
  "utf8",
);
const containerSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/TaskDetail/MainPageComponents/TaskInfoColumnContainer.tsx",
  ),
  "utf8",
);

function taskInfoContainer(source) {
  return source.slice(
    source.indexOf("<TaskInfoColumnContainer"),
    source.indexOf(">", source.indexOf("<TaskInfoColumnContainer")) + 1,
  );
}

function assertContentSizedDesktopRail(source) {
  const container = taskInfoContainer(source);

  assert.match(container, /heightVariant="fit"/);
  assert.match(
    container,
    /maxHeight: `calc\(100dvh - \$\{dynamicTopValue\}px - 16px\)`/,
  );
  assert.match(container, /overflowY: "auto"/);
  assert.match(container, /overscrollBehavior: "contain"/);
  assert.doesNotMatch(
    container,
    /(?<!max)Height: `calc\(100dvh - \$\{dynamicTopValue\}px - 16px\)`/,
  );
  assert.match(container, /_mbl\s*\? \{ top: dynamicTopValue \}/);
}

test("authenticated task properties size to content until they reach the viewport", () => {
  assertContentSizedDesktopRail(taskInfoSource);
});

test("shared task properties use the same content-sized desktop rail", () => {
  assertContentSizedDesktopRail(sharedTaskInfoSource);
});

test("the shared container maps fit to h-fit and keeps desktop sticky", () => {
  assert.match(
    containerSource,
    /heightVariant === "fit" \? "h-fit" : "h-full"/,
  );
  assert.match(containerSource, /const DESKTOP_CLASSES =\s*\n\s*"sticky /);
  assert.match(
    containerSource,
    /mobileResponsive && _mbl[\s\S]*MOBILE_CLASSES[\s\S]*DESKTOP_CLASSES/,
  );
});
