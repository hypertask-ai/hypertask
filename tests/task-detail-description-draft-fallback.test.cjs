const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("task detail ignores empty description drafts when choosing displayed content", () => {
  const body = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx",
  );

  assert.match(
    body,
    /draftTQ\?\.find\(\(draft: IDraft\) => isMeaningfulDescriptionDraft\(draft\)\)/,
  );
  assert.doesNotMatch(
    body,
    /draft\?\.type === ["']Description["']/,
    "an empty auto-created Description draft must not mask persisted content",
  );
});

test("task detail starts loading its always-mounted description editor right after hydration", () => {
  // HTPR-6047 put the editor in the route graph so it never waterfalls; HTPR-7091
  // keeps that promise (the slot imports it as soon as it mounts, and again on any
  // edit intent) while the static description paints first.
  const body = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx",
  );
  const slot = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptionEditorSlot.tsx",
  );

  assert.match(body, /<DescriptionEditorSlot/);
  assert.doesNotMatch(body, /from "@\/components\/RTE\/TipTapTaskDetail"/);
  assert.match(slot, /import\("@\/components\/RTE\/TipTapTaskDetail"\)/);
  assert.match(slot, /const load = useCallback\(\(\) => \{\s*preloadDescriptionEditor\(\)/);
  assert.match(slot, /useEffect\(\(\) => \{\s*if \(!lazy\) return;[\s\S]*load\(\);/);
  assert.match(slot, /onPointerDownCapture: load, onFocusCapture: load, onKeyDownCapture: load/);
});

test("the meaningful-draft guard rejects the empty formats created for new tasks", () => {
  const hook = read("src/hooks/General/useHasDrafts.ts");

  assert.match(hook, /"<p><\/p>"/);
  assert.match(
    hook,
    /"<html><head><\/head><body><p><\/p><\/body><\/html>"/,
  );
  assert.match(hook, /!EMPTY_DESCRIPTION_DRAFTS\.has\(content\)/);
});
