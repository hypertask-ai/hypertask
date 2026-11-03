// HTPR-8376: a comment list projection must name the valid fields instead of dropping a name it does not know.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const listQueryPath = path.join(root, "src/lib/mcp/listQuery.ts");
const operationPath = path.join(root, "src/lib/mcp/operations/comments/operation.ts");

function loadListQuery() {
  const javascript = ts.transpileModule(fs.readFileSync(listQueryPath, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, require);
  return mod.exports;
}

const COMMENT_FIELDS = [
  "id",
  "text",
  "commentText",
  "createdAt",
  "editedAt",
  "editedBy",
  "creatorId",
  "creator",
  "agent",
  "agent_display_name",
  "attachments",
  "reactions",
];

test("a field name the row does not know is reported, not dropped", () => {
  const { assertKnownProjectionFields, ListQueryParseError } = loadListQuery();
  assert.throws(
    () => assertKnownProjectionFields(["createdAt", "kind"], COMMENT_FIELDS),
    (error) => {
      assert.ok(error instanceof ListQueryParseError);
      assert.match(error.message, /fields must be a comma-separated subset of: id, text, commentText/);
      assert.match(error.message, /not known: kind/);
      return true;
    },
  );
});

test("every known field and a nested path pass", () => {
  const { assertKnownProjectionFields, unknownProjectionFields } = loadListQuery();
  assert.doesNotThrow(() => assertKnownProjectionFields(COMMENT_FIELDS, COMMENT_FIELDS));
  assert.deepEqual(unknownProjectionFields(["creator.email", "attachments"], COMMENT_FIELDS), []);
  assert.deepEqual(unknownProjectionFields([], COMMENT_FIELDS), []);
});

test("an empty projection stays valid", () => {
  const { assertKnownProjectionFields } = loadListQuery();
  assert.doesNotThrow(() => assertKnownProjectionFields([], COMMENT_FIELDS));
});

test("the comment list validates its fields and lists the real row keys", () => {
  const operation = fs.readFileSync(operationPath, "utf8");
  assert.match(operation, /assertKnownProjectionFields\(/);
  const allowlist = operation.match(/COMMENT_LIST_FIELDS = \[([\s\S]*?)\] as const/);
  assert.ok(allowlist, "COMMENT_LIST_FIELDS must be declared");
  for (const field of ["commentText", "creator", "agent_display_name", "reactions", "attachments"]) {
    assert.match(allowlist[1], new RegExp(`'${field}'`));
  }
  assert.match(operation, /status: 400/);
});
