const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(
    path.resolve(__dirname, ".."),
    "src/components/Modals/commands/manageColumn.tsx",
  ),
  "utf8",
);

test("mobile column editing restores the existing Save action", () => {
  assert.match(source, /useContext\(MobileViewContext\)/);

  const mobileSave = source.match(
    /\{isMobile\s*&&\s*\([\s\S]*?<button[\s\S]*?<\/button>[\s\S]*?\)\}/,
  )?.[0];
  assert.ok(mobileSave, "mobile edit mode should render a dedicated action");
  assert.match(mobileSave, />\s*Save\s*</);
  assert.match(mobileSave, /onClick=\{onSubmit\}/);
});

test("the Save action uses the existing rename persistence path", () => {
  assert.match(
    source,
    /const onSubmit = \(\) => \{[\s\S]*?queueSave\(\(\) => handleSectionUpdateVis\(editSection!, "RENAME"\)\)/,
  );
  assert.match(
    source,
    /saveMode === "RENAME"[\s\S]*?axios\.post\(`\/api\/section\/update`/,
  );
});

test("desktop keeps the existing blur auto-save behavior", () => {
  assert.match(source, /onBlur=\{isMobile \? undefined : saveTitleOnBlur\}/);
  assert.doesNotMatch(source, /\{!isMobile\s*&&\s*\([\s\S]*?>\s*Save\s*</);
});
