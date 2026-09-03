const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { shouldMountTaskDescriptionEditor } = jiti(
  path.join(
    root,
    "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/descriptionRenderMode.ts",
  ),
);

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

test("task detail mounts the rich editor only for edit and draft states", () => {
  const readOnly = {
    editMode: null,
    hasDraft: false,
    hasDraftInit: false,
  };
  assert.equal(shouldMountTaskDescriptionEditor(readOnly), false);
  assert.equal(
    shouldMountTaskDescriptionEditor({ ...readOnly, editMode: "description" }),
    true,
  );
  assert.equal(
    shouldMountTaskDescriptionEditor({ ...readOnly, editMode: "description-ai" }),
    true,
  );
  assert.equal(
    shouldMountTaskDescriptionEditor({ ...readOnly, hasDraft: true }),
    true,
  );
  assert.equal(
    shouldMountTaskDescriptionEditor({ ...readOnly, hasDraftInit: true }),
    true,
  );

  const body = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx",
  );
  const renderer = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription.tsx",
  );
  assert.match(body, /const isEditing = shouldMountTaskDescriptionEditor/);
  assert.match(body, /\{isEditing \? \([\s\S]*?<Tiptap[\s\S]*?: \([\s\S]*?<InnerHTMLDescription/);
  assert.match(body, /id="description-input"/);
  assert.match(body, /taskDetailContentReady/);
  assert.match(renderer, /sanitizeRenderedRichHtml\(/);
  assert.match(renderer, /data-task-detail-content-ready=\{taskDetailContentReady \? "true" : undefined\}/);
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
