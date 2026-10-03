const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const button = read("src/components/PageComponents/Kanban/KanbanSectionComponents/NewTaskButton.tsx");
const onboarding = read("src/components/PageComponents/Interactive-Onboarding/Components/Landing/Section.tsx");
const bottom = button.slice(button.indexOf('else if (buttonPosition ==="bottom"'));

function assertGhostClasses(source) {
  assert.doesNotMatch(source, /\bbg-opacity-\d+\b|\bbg-slate-500\b/);
  // HTPR-6875: a fill class (even bg-transparent) beats the hover color in the live CSS.
  assert.doesNotMatch(source, /(^|\s)bg-(transparent|[a-z]+-\d+)\b/);
  assert.match(source, /\bhover:bg-hover-active\b/);
}

test("bottom add-task buttons use theme-aware ghost styling, not removed opacity utilities", () => {
  assertGhostClasses(bottom);
  const tutorialButton = onboarding.match(/<div className="([^"]+)">\s*<Plus[^>]+\/>/);
  assert.ok(tutorialButton, "the tutorial bottom action must exist");
  assertGhostClasses(tutorialButton[1]);
  assert.match(tutorialButton[0], /size=\{14\}/);
  assert.match(tutorialButton[0], /text-text-light-gray/);
});

test("the styling guard rejects the original solid-background pattern", () => {
  assert.throws(() => assertGhostClasses("bg-slate-500 bg-opacity-20 hover:bg-opacity-70"));
  assert.throws(() => assertGhostClasses("bg-transparent hover:bg-hover-active bg-opacity-20"));
  assert.throws(() => assertGhostClasses("bg-transparent hover:bg-hover-active"));
});

test("the bottom action keeps its click, tooltip, drag suppression and responsive reveal", () => {
  assert.match(bottom, /!snapshot\?\.isDraggingOver/);
  assert.match(bottom, /onClick=\{\(\)=>createTaskAt\("bottom", sectionPayload, undefined, quickEntryRequested\)\}/);
  assert.match(bottom, /scale-100 sm:scale-0/);
  assert.match(bottom, /group-hover\/main:scale-100/);
  assert.match(bottom, /text='Create task' keyCombination=\{nQuickAddEnabled && quickEntryCardsEnabled \? \["N \/ Shift\+C"\] : \["C"\]\} left=\{20\} bottom=\{-40\}/);
  assert.match(bottom, /size=\{14\} className='text-text-light-gray'/);
  assert.match(button, /size = 10, className = 'text-white-black'/);
  assert.match(button, /<Plus size=\{size\} className=\{`sm:mx-0 xs:mx-2 \$\{className\}`\} strokeWidth=\{1\.75\}/);
  assert.match(button, /text='Create task at top' keyCombination=\{\["C"\]\} left=\{left\} bottom=\{bottom\}\/\>/);
});
