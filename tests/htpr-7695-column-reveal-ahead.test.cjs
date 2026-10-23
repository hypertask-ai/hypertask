const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const section = fs.readFileSync(
  path.join(root, "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx"),
  "utf8",
);
const revealObserver = section.slice(
  section.indexOf("const observer = new IntersectionObserver(\n      (entries) => {\n        for (const entry of entries) {\n          const taskId"),
);

test("with the flag on, cards reveal one column height ahead inside the column that scrolls", () => {
  assert.match(
    revealObserver,
    /revealAheadInColumn\s*\?\s*\{\s*root: root\.querySelector<HTMLElement>\(\s*isMbl\s*\?\s*`#tasks-list-\$\{index\}`\s*:\s*`#droppable-section-container-\$\{section\.sectionId\}`,?\s*\),\s*rootMargin: "100% 0px",/,
  );
  assert.match(section, /id=\{`droppable-section-container-\$\{section\.sectionId\}`\}/);
  assert.match(section, /id=\{`tasks-list-\$\{index\}`\}/);
});

test("with the flag off, the old viewport margin stays", () => {
  assert.match(revealObserver, /:\s*\{\s*rootMargin: "240px 160px",\s*\}/);
});

test("the observer restarts when the flag or the column changes", () => {
  const start = revealObserver.indexOf("}, [");
  const deps = revealObserver.slice(start, revealObserver.indexOf("]);", start));
  for (const dep of ["revealAheadInColumn", "isMbl", "index", "section.sectionId"]) {
    assert.ok(deps.includes(dep), `missing dependency ${dep}`);
  }
});

test("the bugfix flag is on for everyone by default", () => {
  const jiti = createJiti(__filename);
  const flag = jiti(path.join(root, "src/lib/flags/definitions/htpr-7695-column-reveal-ahead.ts")).default;
  assert.equal(flag.key, "htpr-7695-column-reveal-ahead");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
});
