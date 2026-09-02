const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/components/RTE/draftSync.ts"),
  "utf8",
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const loaded = { exports: {} };
new Function("module", "exports", javascript)(loaded, loaded.exports);
const {
  getTaskDraftContent,
  normalizeEditorHtml,
  shouldSkipUnchangedMobileDescriptionSave,
  shouldSyncDraft,
} = loaded.exports;

// An editor the user has emptied serialises to "<p></p>", the API stores "". If
// those read as different documents, a deleted draft can never clear the composer.
test("an empty editor and an empty draft are the same document", () => {
  assert.equal(normalizeEditorHtml("<p></p>"), normalizeEditorHtml(""));
  assert.equal(normalizeEditorHtml(undefined), "");
});

test("a draft arriving after mount is seeded into the untouched editor", () => {
  assert.equal(shouldSyncDraft("<p>from the CLI</p>", "", false), true);
});

// The reported regression: the composer kept showing the older draft forever.
test("a rewritten draft replaces the older one the editor is showing", () => {
  assert.equal(shouldSyncDraft("<p>newer</p>", "<p>older</p>", false), true);
});

test("a draft deleted elsewhere clears the untouched composer showing it", () => {
  assert.equal(shouldSyncDraft("", "<p>deleted draft</p>", false), true);
});

// The safety property. A stale refetch, a failed autosave echo, or a draft the API
// recreated from an in-flight request must never win against the user, and the
// editor matching the cache again is not proof the cache is authoritative — which
// is why this stays a one-way flag and not a content comparison.
test("text the user typed is never overwritten, even by identical-looking state", () => {
  assert.equal(shouldSyncDraft("<p>stale draft</p>", "<p>what I typed</p>", true), false);
  assert.equal(shouldSyncDraft("<p>what I typed</p>", "<p>what I typed</p>", true), false);
});

// Posting clears the editor through the editor, which counts as an edit, so a
// draft the server recreated afterwards cannot come back as ghost content.
test("a comment already posted cannot reappear in the composer", () => {
  assert.equal(shouldSyncDraft("<p>what I posted</p>", "", true), false);
});

test("no work when the editor already shows the stored draft", () => {
  assert.equal(shouldSyncDraft("<p>same</p>", "<p>same</p>", false), false);
});

test("Done closes an unchanged mobile description without saving it again", () => {
  assert.equal(
    shouldSkipUnchangedMobileDescriptionSave({
      isMobileExistingSave: true,
      mode: "read-edit-description",
      hasDraft: false,
      openingHtml: "<p>same</p>",
      currentHtml: "<p>same</p>",
      attachmentsChanged: false,
    }),
    true,
  );
});

test("Done still saves real description, attachment, and draft changes", () => {
  const base = {
    isMobileExistingSave: true,
    mode: "read-edit-description",
    hasDraft: false,
    openingHtml: "<p>before</p>",
    currentHtml: "<p>before</p>",
    attachmentsChanged: false,
  };

  assert.equal(
    shouldSkipUnchangedMobileDescriptionSave({
      ...base,
      currentHtml: "<p>after</p>",
    }),
    false,
  );
  assert.equal(
    shouldSkipUnchangedMobileDescriptionSave({
      ...base,
      attachmentsChanged: true,
    }),
    false,
  );
  assert.equal(
    shouldSkipUnchangedMobileDescriptionSave({ ...base, hasDraft: true }),
    false,
  );
  assert.equal(
    shouldSkipUnchangedMobileDescriptionSave({
      ...base,
      mode: "read-edit-comments",
    }),
    false,
  );
});

test("comment hydration accepts only the open task's comment draft", () => {
  const drafts = [
    { taskId: 101, type: "Description", content: "<p>task description</p>" },
    { taskId: 202, type: "Comment", content: "<p>foreign comment</p>" },
    { taskId: 101, type: "Comment", content: "<p>matching comment</p>" },
  ];

  assert.equal(
    getTaskDraftContent(drafts, 101, "Comment"),
    "<p>matching comment</p>",
  );
});

test("comment hydration ignores foreign and unscoped drafts", () => {
  const drafts = [
    { taskId: 202, type: "Comment", content: "<p>foreign comment</p>" },
    { type: "Comment", content: "<p>unscoped comment</p>" },
  ];

  assert.equal(getTaskDraftContent(drafts, 101, "Comment"), "");
  assert.equal(getTaskDraftContent(drafts, undefined, "Comment"), "");
});

test("desktop and mobile comment editors remount for each task", () => {
  const component = fs.readFileSync(
    path.join(
      __dirname,
      "../src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx",
    ),
    "utf8",
  );
  const taskBoundKey = 'key={`comment-input-${_parsedTask.id}`}';

  assert.equal(component.split(taskBoundKey).length - 1, 2);
  assert.match(component, /getTaskDraftContent\(\s*draftsFromTQ,\s*_parsedTask\?\.id,\s*"Comment"/);
});
