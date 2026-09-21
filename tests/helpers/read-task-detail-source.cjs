const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

function readTaskDetailSource() {
  return [
    "TaskDetailController.tsx",
    "taskDetailCommands.ts",
    "TaskDetailPanels.tsx",
    "TaskDetailPanelParts.tsx",
  ]
    .map((file) =>
      fs.readFileSync(path.join(root, "src/lib/taskDetail", file), "utf8"),
    )
    .join("\n");
}

module.exports = { readTaskDetailSource };
