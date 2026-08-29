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

test("the meaningful-draft guard rejects the empty formats created for new tasks", () => {
  const hook = read("src/hooks/General/useHasDrafts.ts");

  assert.match(hook, /"<p><\/p>"/);
  assert.match(
    hook,
    /"<html><head><\/head><body><p><\/p><\/body><\/html>"/,
  );
  assert.match(hook, /!EMPTY_DESCRIPTION_DRAFTS\.has\(content\)/);
});
