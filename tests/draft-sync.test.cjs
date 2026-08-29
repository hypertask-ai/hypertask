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
const { shouldSyncDraft, normalizeEditorHtml } = loaded.exports;

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
