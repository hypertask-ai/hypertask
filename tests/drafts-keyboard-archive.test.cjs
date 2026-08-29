const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/app/drafts/Drafts.tsx"),
  "utf8",
);

test("the Drafts page routes the inbox E shortcut to scoped draft archival", () => {
  assert.match(source, /markAsDone=\{archiveDraft\}/);
  assert.match(source, /USER_DRAFTS_QUERY_KEY\(currentUser\.id\)/);
  assert.match(
    source,
    /axios\.post\("\/api\/drafts\/archiveDraft", \{ draftId \}\)/,
  );
});

test("archiving removes the selected draft optimistically and can roll it back", () => {
  assert.match(source, /archivingDraftId\.current !== null/);
  assert.match(source, /cancelQueries\(\{ queryKey, exact: true \}\)/);
  assert.match(source, /draft\.id === draftId \? \{ \.\.\.draft, saved: true \} : draft/);
  assert.match(source, /draft\.id === draftId \? previousDraft : draft/);
  assert.match(source, /draft\.saved !== true/);
  assert.equal(
    (source.match(/invalidateQueries\(\{ queryKey, exact: true \}\)/g) || [])
      .length,
    2,
    "success and failure both reconcile with the server",
  );
});
