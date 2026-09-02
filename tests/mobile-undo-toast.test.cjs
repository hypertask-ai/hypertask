// HTPR-5564: the approved wireframe moves the mobile undo pill to the LEFT so
// it stops covering the task actions on the right, and gives mobile the same
// Dismiss X the desktop toast already has. Dismissing the prompt still must
// not shorten what can still be undone. HTPR-5872 then halves the mobile
// window: toast and action window drop to 7.5s together, desktop stays 15s.
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

test("the mobile pill uses a compact visual footprint", () => {
  const start = undoToastSource.indexOf("if (isMbl)");
  const end = undoToastSource.indexOf("\n  }\n\n  return (", start);
  const mobileBranch = undoToastSource.slice(start, end);

  assert.match(mobileBranch, /max-w-\[110px\]/);
  assert.match(mobileBranch, /\bgap-1\b/);
  assert.match(mobileBranch, /\bpx-2\b/);
  assert.match(mobileBranch, /\bpy-1\b/);
  assert.match(mobileBranch, /absolute -right-3 -top-3/,
    "the 44px Dismiss target stays out of the pill layout");
  assert.doesNotMatch(mobileBranch, /max-w-\[150px\]|px-3\.5|py-2\.5/);
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

test("toast and undo window stay in lockstep on every viewport", () => {
  assert.equal(undoToastSource.includes("UNDO_TOAST_DURATION_MS = UNDO_ACTION_WINDOW_MS"), true);
  assert.equal(undoToastSource.includes("MOBILE_UNDO_TOAST_DURATION_MS = MOBILE_UNDO_ACTION_WINDOW_MS"), true);
  assert.equal(undoToastSource.includes("UNDO_ACTION_WINDOW_MS = 15_000"), true);
  assert.equal(undoToastSource.includes("MOBILE_UNDO_ACTION_WINDOW_MS = 7_500"), true);
  assert.match(
    undoToastSource,
    /duration: isMobile\s*\?\s*MOBILE_UNDO_TOAST_DURATION_MS\s*:\s*UNDO_TOAST_DURATION_MS/,
  );
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
