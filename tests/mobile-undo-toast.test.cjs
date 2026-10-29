const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const undoToastSource = read("src/components/undoToast/index.tsx");

test("the compact mobile toast keeps Undo and scoped Dismiss actions", () => {
  assert.match(undoToastSource, /aria-label="Dismiss"/);
  assert.match(undoToastSource, /onClick=\{\(\) => toast\.dismiss\(t\.id, SINGLE_UNDO_TOASTER_ID\)\}/);
  assert.match(undoToastSource, /<X size=\{14\} \/>/);
  assert.match(undoToastSource, /aria-label="Undo"/);
  assert.match(undoToastSource, /onClick=\{\(\) => onUndo\(t\.id\)\}/);
  assert.equal((undoToastSource.match(/isMbl \? MOBILE_TARGET : ""/g) ?? []).length, 2);
});

test("the compact toast keeps its shared visual footprint", () => {
  assert.match(undoToastSource, /min-h-10 max-w-full items-center gap-2/);
  assert.match(undoToastSource, /rounded-\[5px\] border-l-\[3px\]/);
  assert.match(undoToastSource, /bg-modalBackground px-3 text-content font-normal text-white-black shadow-md/);
  assert.match(undoToastSource, /transition: "opacity 200ms ease-in-out"/);
});

test("the five-second toast keeps the longer desktop and mobile undo windows", () => {
  assert.match(undoToastSource, /UNDO_ACTION_WINDOW_MS = 15_000/);
  assert.match(undoToastSource, /MOBILE_UNDO_ACTION_WINDOW_MS = 7_500/);
  assert.match(undoToastSource, /duration: 5000/);
  assert.match(undoToastSource, /removeDelay: 200/);
});

// The existing viewport argument remains accepted by every caller.
test("every UndoToaster call site keeps its compatible viewport argument", () => {
  const callers = [
    "src/hooks/General/useUndo.tsx",
    "src/components/RTE/Components/ImproveButton.tsx",
    "src/components/RTE/Components/MobileCommentImproveButton.tsx",
  ];
  for (const rel of callers) {
    const source = read(rel);
    const callSite = source.indexOf("UndoToaster(");
    assert.ok(callSite !== -1, `${rel} calls UndoToaster`);
    assert.match(
      source.slice(callSite),
      /,\s*(isMobile|true)\s*,?\s*\)/m,
      `${rel} passes isMobile as the last argument`,
    );
  }
});

// useUndo reads MobileViewContext; if the provider tree ever nests
// UndoProvider outside MobileViewProvider again, the context default (false)
// silently pins every mobile undo toast to the desktop position.
test("UndoProvider sits inside MobileViewProvider", () => {
  const providers = read("src/utils/Providers.tsx");
  const mobileIdx = providers.indexOf("<MobileViewProvider");
  const undoIdx = providers.indexOf("<UndoProvider>");
  assert.ok(mobileIdx !== -1 && undoIdx !== -1);
  assert.ok(mobileIdx < undoIdx, "MobileViewProvider must wrap UndoProvider");
});
