const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// HTPR-5513: the desktop properties rail is `position: sticky` inside the
// comments + rail row. A sticky element can never be painted below its
// containing block, so any trailing space that sits BELOW that row (page
// bottom padding) drags the rail up by exactly that height once you scroll to
// the end of a long thread — the properties scroll out of view and cannot be
// scrolled back independently. The trailing space must live inside the row.

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
