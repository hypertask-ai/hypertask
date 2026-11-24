const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const { getKeyboardShortcuts } = jiti(path.join(root, "src/lib/constants/shortcuts.ts"));

test("the Task View shortcut group ends with G then G jump to top", () => {
  const groups = getKeyboardShortcuts(true, false, "Toggle history events", true, true);
  const taskView = groups.find((group) => group.title === "Task View");
  assert.ok(taskView, "the shortcut list keeps its Task View group");
  assert.deepEqual(taskView.sub.at(-1), { shortTitle: "Jump to top", pressKey: ["G", null, "G"] });
  assert.equal(
    groups.flatMap((group) => group.sub).filter((row) => row.shortTitle === "Jump to top").length,
    1,
  );
});
