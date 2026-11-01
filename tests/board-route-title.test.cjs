const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
    })
  : jitiModule(__filename, { interopDefault: true, cache: false });
const {
  buildBoardRouteTitle,
  resolveBoardRouteTitleRequest,
} = jiti(path.join(root, "src/lib/boardRouteTitle.ts"));

test("keeps the board name in every board-only browser title", () => {
  assert.equal(buildBoardRouteTitle("inne"), "inne • Hypertask");
  assert.equal(buildBoardRouteTitle("  inne  "), "inne • Hypertask");
});

test("puts a named saved view before its board", () => {
  assert.equal(
    buildBoardRouteTitle("inne", "Growth"),
    "Growth • inne • Hypertask",
  );
});

test("resolves direct and previous-board title requests safely", () => {
  assert.deepEqual(
    resolveBoardRouteTitleRequest({ id: "339", view: "default" }),
    { projectId: "339", viewSlug: null },
  );
  assert.deepEqual(
    resolveBoardRouteTitleRequest({}, "project-15|&|bugs"),
    { projectId: "15", viewSlug: null },
  );
  assert.deepEqual(
    resolveBoardRouteTitleRequest({ id: "339", view: ["growth", "other"] }),
    { projectId: "339", viewSlug: "growth" },
  );
  assert.deepEqual(
    resolveBoardRouteTitleRequest({ id: "not-a-board", view: "growth" }),
    { projectId: null, viewSlug: "growth" },
  );
});
