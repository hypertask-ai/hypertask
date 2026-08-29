const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { buildSortComparator, comparatorForSortingMode } = jiti(
  path.join(root, "src/utils/helperFunctions/helperFunctions.ts")
);

module.exports = {
  buildSortComparator,
  comparatorForSortingMode,
};
