const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// The view tools refused an unknown tag with "Label(s) not found in project: X"
// and no list of the tags the board actually has, so the caller had to hunt for
// them. The tag tools already name what exists; this test holds the view path to
// the same text. Compile the real helper so the test cannot drift from it.
function loadUnresolvedLabelMessage() {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/lib/mcp/tasks/services.ts"),
    "utf8"
  );
  const start = source.indexOf("export function unresolvedLabelMessage");
  assert.notEqual(start, -1, "unresolvedLabelMessage must exist in tasks/services.ts");
  const end = source.indexOf("export async function resolveLabelIds");
  const snippet = source.slice(start, end).replace("export function", "function");
  const js = ts.transpileModule(snippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(`${js}; return unresolvedLabelMessage;`)();
}

const unresolvedLabelMessage = loadUnresolvedLabelMessage();

const LABELS = [
  { id: "2e164f24-uuid", value: "AI Task Writer" },
  { id: "098dbf4d-uuid", value: "AI" },
  { id: "4927765d-uuid", value: null },
];

test("names the unknown tag and lists the tags the board has", () => {
  assert.equal(
    unresolvedLabelMessage(["Backlog"], LABELS),
    "Label(s) not found in project: Backlog. Available labels: AI Task Writer, AI"
  );
});

test("names every unknown tag in the order the caller sent them", () => {
  assert.equal(
    unresolvedLabelMessage(["Mobile", "Backlog"], LABELS),
    "Label(s) not found in project: Mobile, Backlog. Available labels: AI Task Writer, AI"
  );
});

test("says none when the board has no tags yet", () => {
  assert.equal(
    unresolvedLabelMessage(["Backlog"], [{ id: "x", value: null }]),
    "Label(s) not found in project: Backlog. Available labels: none"
  );
});

test("the view tools throw the clear message behind the ticket flag", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/lib/mcp/views/services.ts"),
    "utf8"
  );
  assert.match(
    source,
    /HTPR_8135_VIEW_LABEL_ERROR_FLAG/,
    "views/services.ts must gate the clear message on the ticket flag"
  );
  assert.match(
    source,
    /throw new ValidationError\(unresolvedLabelMessage\(unresolved, projectLabels\)\)/,
    "views/services.ts must throw the clear label message as a validation error"
  );
  assert.match(
    source,
    /buildLabelsFilterEntry\(projectId, filters\?\.label_names, userId\)/,
    "the flag needs the requesting user, so createView must pass userId"
  );
  assert.match(
    source,
    /buildLabelsFilterEntry\(projectId, input\.filters\.label_names, userId\)/,
    "updateView must pass userId as well"
  );
});

test("the flag ships for everyone as a bugfix", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/lib/flags/definitions/htpr-8135-view-label-error.ts"),
    "utf8"
  );
  assert.match(source, /kind: "bugfix"/);
  assert.match(source, /defaultMode: "EVERYONE"/);
});
