// HTPR-5564: the approved wireframe moves the mobile undo pill to the LEFT so
// it stops covering the task actions on the right, and gives mobile the same
// Dismiss X the desktop toast already has. The undo window itself stays at
// 15s — dismissing the prompt must not shorten what can still be undone.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const undoToastSource = read("src/components/undoToast/index.tsx");

test("the mobile pill gains the desktop Dismiss action next to its label", () => {
  const start = undoToastSource.indexOf("if (isMbl)");
  const end = undoToastSource.indexOf("\n  }\n\n  return (", start);
  assert.ok(start !== -1 && end !== -1 && end > start,
    "the component keeps distinct mobile and desktop branches");
  const mobileBranch = undoToastSource.slice(start, end);

  assert.ok(mobileBranch.includes('aria-label="Dismiss"'),
    "mobile pill renders a Dismiss X");
  assert.match(
    mobileBranch,
    /onClick=\{\(\) => toast\.dismiss\(t\.id\)\}[\s\S]*?>\s*X\s*<\/button>/,
    "Dismiss really dismisses the toast",
  );
  assert.match(mobileBranch, /aria-label="Undo"/,
    "Undo is still a real button");
});

test("the mobile pill anchors left of the task actions", () => {
  // Exit animation slides toward the new left anchor.
  assert.match(undoToastSource, /translateX\(-16px\)/);
  // The left anchor comes from this toast's own per-toast position...
  assert.match(
    undoToastSource,
    /position: isMobile \? "top-left" : "bottom-left"/,
  );
  // ...so ordinary mobile toasts keep their right anchor: the shared
  // container stays free of a hard left override.
  const globals = read("src/styles/globals.scss");
  const container = globals.slice(
    globals.indexOf(".toastContainerMobile {"),
    globals.indexOf(".toastP"),
  );
  assert.doesNotMatch(container, /\bleft:/,
    ".toastContainerMobile must not force every mobile toast to the left");
});

test("the undo window stays in lockstep at 15 seconds", () => {
  assert.equal(undoToastSource.includes("UNDO_TOAST_DURATION_MS = UNDO_ACTION_WINDOW_MS"), true);
  assert.equal(undoToastSource.includes("UNDO_ACTION_WINDOW_MS = 15_000"), true);
  assert.equal(undoToastSource.includes("duration: UNDO_TOAST_DURATION_MS"), true);
});

// The viewport flag is part of the signature now; every caller passes it.
test("every UndoToaster call site passes the viewport flag", () => {
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
