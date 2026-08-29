const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  applyFilters,
  assigneeFilterCondition,
  labelFilterCondition,
} = jiti(
  path.join(root, "src/utils/helperFunctions/Views/FilterHelperFunctions.ts")
);

const { supportsMatchMode } = jiti(path.join(root, "src/models/Filters/model.ts"));

module.exports = {
  applyFilters,
  assigneeFilterCondition,
  labelFilterCondition,
  supportsMatchMode,
};
