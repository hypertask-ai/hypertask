const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { getActiveShowArchivedOverrideFromProject, resolveShowArchivedForBoard, resolveShowArchivedRequest } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts")
);

const { getViewAppliedArchivedTasks } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/ArchivedTasksHelper.ts")
);

module.exports = {
  getActiveShowArchivedOverrideFromProject,
  resolveShowArchivedForBoard,
  resolveShowArchivedRequest,
  getViewAppliedArchivedTasks,
};
