const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");


const mainContainerSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/TaskDetail/TaskDetailMainContainer.tsx",
  ),
  "utf8",
);
const commentsSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/TaskDetail/CommentAndDescription/index.tsx",
  ),
  "utf8",
);

test("the task detail page wrapper adds no space below the sticky rail's row", () => {
  const desktopBody = mainContainerSource.slice(
    mainContainerSource.indexOf('"w-full min-w-0 min-h-screen'),
    mainContainerSource.indexOf('"w-full min-w-0 min-h-screen') + 400,
  );
  const desktopClasses = desktopBody.slice(0, desktopBody.indexOf('"', 1) + 1);

  assert.match(desktopClasses, /min-h-screen/);
  assert.doesNotMatch(desktopClasses, /pb-/);
});

test("the trailing space below the composer lives inside the comments column", () => {
  assert.match(
    commentsSource,
    /className="shrink-0 @sm:h-6 @lg:h-16 @xl:h-48"/,
  );
});
