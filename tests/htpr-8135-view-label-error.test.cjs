const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const { unresolvedLabelMessage } = load("src/lib/mcp/labelMessages.ts", {});

// The view tools refused an unknown tag with "Label(s) not found in project: X"
// and never said which tags the board has, so an agent had to guess. The tag
// tools already answer that question; this helper is now the one wording both
// paths use, so they cannot drift apart again.
test("names the unknown tag and lists the tags the board has", () => {
  assert.equal(
    unresolvedLabelMessage(["Backlog"], [
      { id: "2e164f24-uuid", value: "AI Task Writer" },
      { id: "098dbf4d-uuid", value: "AI" },
    ]),
    "Label(s) not found in project: Backlog. Available labels: AI Task Writer, AI"
  );
});

test("names every unknown tag in the order the caller sent them", () => {
  assert.equal(
    unresolvedLabelMessage(["Mobile", "Backlog"], [{ id: "098dbf4d-uuid", value: "AI" }]),
    "Label(s) not found in project: Mobile, Backlog. Available labels: AI"
  );
});

test("says none when the board has no tags yet", () => {
  assert.equal(
    unresolvedLabelMessage(["Backlog"], [{ id: "4927765d-uuid", value: null }]),
    "Label(s) not found in project: Backlog. Available labels: none"
  );
});

test("the flag ships for everyone as a bugfix", () => {
  const definition = load("src/lib/flags/definitions/htpr-8135-view-label-error.ts", {});
  assert.equal(definition.HTPR_8135_VIEW_LABEL_ERROR_FLAG, "htpr-8135-view-label-error");
  assert.equal(definition.default.kind, "bugfix");
  assert.equal(definition.default.defaultMode, "EVERYONE");
});
