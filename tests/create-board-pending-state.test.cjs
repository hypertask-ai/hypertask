const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { getCreateBoardPendingHeader } = jiti(
  path.join(
    root,
    "src/components/Modals/commands/createBoardStatus.ts",
  ),
);

test("board creation uses neutral copy until the API confirms success", () => {
  assert.equal(getCreateBoardPendingHeader("Customer launch"), "Creating board: Customer launch");
  assert.doesNotMatch(getCreateBoardPendingHeader("Customer launch"), /redirect/i);
});

test("the pending board title stays bounded", () => {
  const longTitle = "A".repeat(51);

  assert.equal(
    getCreateBoardPendingHeader(longTitle),
    `Creating board: ${"A".repeat(50)}...`,
  );

  assert.equal(
    getCreateBoardPendingHeader(`${"A".repeat(49)}🇺🇸B`),
    `Creating board: ${"A".repeat(49)}🇺🇸...`,
  );
});
