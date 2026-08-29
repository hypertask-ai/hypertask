// HTPR-4894: the free tier allows 3 owned boards. The cap has to hold for the
// board the user is ABOUT to create, so the predicate compares with >=, not >:
// at 3 owned boards the next create is the one that must fail. A paid (or comped)
// plan lifts it entirely — a regression here silently bills nobody but locks
// paying teams out of their own workspace.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, "tests/board-quota-jiti.cjs"), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, relativePath));
}

const { FREE_BOARD_LIMIT, FREE_BOARD_LIMIT_MESSAGE, isOverFreeBoardLimit } =
  loadTs("src/utils/controllers/projects/boardQuota.ts");

test("free accounts may create up to the limit", () => {
  for (let owned = 0; owned < FREE_BOARD_LIMIT; owned++) {
    assert.equal(
      isOverFreeBoardLimit(owned, false),
      false,
      `owning ${owned} boards must still allow a create`
    );
  }
});

test("the create that would exceed the limit is blocked", () => {
  assert.equal(isOverFreeBoardLimit(FREE_BOARD_LIMIT, false), true);
  assert.equal(isOverFreeBoardLimit(FREE_BOARD_LIMIT + 5, false), true);
});

test("a paid plan lifts the cap entirely", () => {
  assert.equal(isOverFreeBoardLimit(FREE_BOARD_LIMIT, true), false);
  assert.equal(isOverFreeBoardLimit(FREE_BOARD_LIMIT * 100, true), false);
});

test("the limit message names the number the code enforces", () => {
  assert.ok(
    FREE_BOARD_LIMIT_MESSAGE.includes(String(FREE_BOARD_LIMIT)),
    "message and limit must not drift apart"
  );
});
