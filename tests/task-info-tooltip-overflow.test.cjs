const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("ticket property tooltips overlay the viewport instead of widening the rail", () => {
  const tooltip = read("src/components/Common/Tooltip.tsx");
  const propertySources = [
    "src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx",
    "src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskTime.tsx",
    "src/components/PageComponents/TaskDetail/AssigneesContainer.tsx",
  ].map(read);

  assert.match(tooltip, /portalAnchorRef\.current\?\.parentElement/);
  assert.match(tooltip, /createPortal\(/);
  assert.match(tooltip, /viewportWidth - tooltipRect\.width - 8/);
  assert.match(tooltip, /window\.addEventListener\("scroll", updateAnchorRect, true\)/);
  assert.match(tooltip, /max-w-\[calc\(100vw-16px\)\]/);
  assert.match(tooltip, /whitespace-normal break-words/);

  for (const source of propertySources) {
    const tooltipCount = source.match(/<Tooltip/g)?.length ?? 0;
    const portalCount = source.match(/<Tooltip\s+portal/g)?.length ?? 0;
    assert.equal(portalCount, tooltipCount);
  }
});

test("multi-line property rows keep their natural height inside the scroll rail", () => {
  const sharedRows = read(
    "src/components/PageComponents/TaskDetail/MainPageComponents/index.tsx",
  );
  const taskInfo = read(
    "src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx",
  );

  assert.match(sharedRows, /flex w-full shrink-0 text/);
  assert.match(taskInfo, /flex shrink-0 flex-col items-start w-full gap-2/);
});
