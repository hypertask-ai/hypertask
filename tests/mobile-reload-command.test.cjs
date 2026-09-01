const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
});
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const { getAllCommands, getMobileCommandGroups } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts")
);

test("Reload app is the first mobile command and is absent on desktop", () => {
  const commands = getAllCommands({ context: "Others" });
  const desktopCommands = getMobileCommandGroups(commands, false);
  const mobileCommands = getMobileCommandGroups(commands, true);

  assert.strictEqual(desktopCommands, commands);
  assert.equal(
    desktopCommands.some((group) =>
      group.commandLists.some(
        (command) => command.commandMode === CommandMode.ReloadApp
      )
    ),
    false
  );
  assert.deepEqual(mobileCommands[0].commandLists[0], {
    key: "reloadApp",
    name: "Reload app",
    commandMode: CommandMode.ReloadApp,
    keywords: "reload refresh restart app page",
  });
});

test("board zoom leads the mobile board commands and has exactly two labels", () => {
  const zoomCommand = (zoomedOut) => {
    const commands = getAllCommands({
      context: "Kanban",
      boardZoomedOut: zoomedOut,
    });
    const mobileCommands = getMobileCommandGroups(commands, true);
    const matches = mobileCommands
      .flatMap((group) => group.commandLists)
      .filter((command) => command.commandMode === CommandMode.ToggleBoardZoom);

    assert.equal(matches.length, 1);
    assert.equal(
      mobileCommands.filter((group) => group.group === "Board").length,
      1,
    );
    assert.equal(mobileCommands[0].commandLists[0].commandMode, CommandMode.ToggleBoardZoom);
    return matches[0];
  };

  assert.equal(zoomCommand(false).name, "Zoom board out");
  assert.equal(zoomCommand(true).name, "Zoom board in");
  assert.equal(
    getAllCommands({ context: "Kanban" }).some((group) =>
      group.commandLists.some(
        (command) => command.commandMode === CommandMode.ToggleBoardZoom,
      ),
    ),
    false,
  );
});
