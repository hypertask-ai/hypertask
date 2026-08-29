const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/view-order-jiti-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { asViewOrder, sortViewsByOrder } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/ViewOrderHelperFunctions.ts")
);

const view = (id, createdAt) => ({ id, createdAt, title: id });

test("asViewOrder accepts only arrays of string ids", () => {
  assert.deepEqual(asViewOrder([]), []);
  assert.deepEqual(asViewOrder(["a", "b"]), ["a", "b"]);
  assert.equal(asViewOrder(null), undefined);
  assert.equal(asViewOrder(["a", 2]), undefined);
});

test("sortViewsByOrder pins the board default and appends missing views by creation", () => {
  const views = [
    view("new", "2026-03-01T00:00:00Z"),
    view("default", "2026-04-01T00:00:00Z"),
    view("old", "2026-01-01T00:00:00Z"),
    view("ordered", "2026-02-01T00:00:00Z"),
  ];

  assert.deepEqual(
    sortViewsByOrder(views, ["ordered"], "default").map(({ id }) => id),
    ["default", "ordered", "old", "new"]
  );
});

test("sortViewsByOrder uses creation order when no stored order exists", () => {
  const views = [
    view("new", "2026-03-01T00:00:00Z"),
    view("old", "2026-01-01T00:00:00Z"),
  ];

  assert.deepEqual(
    sortViewsByOrder(views, undefined, undefined).map(({ id }) => id),
    ["old", "new"]
  );
});
