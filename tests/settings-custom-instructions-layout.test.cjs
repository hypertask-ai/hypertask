const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("custom instructions keeps a definite full-height editor chain", () => {
  const settingsShell = read(
    "src/components/Modals/Settings/SettingsShell.tsx",
  );
  const boardAiSection = read(
    "src/components/Modals/Settings/BoardAiSection.tsx",
  );
  const promptInput = read(
    "src/components/Modals/AICustomPrompt/AICustomPromptInput.tsx",
  );

  assert.match(
    settingsShell,
    /"mx-auto flex h-full min-h-full w-full max-w-\[760px\] flex-col pb-8"/,
  );
  assert.match(boardAiSection, /<SettingsSectionShell fullHeight/);
  assert.match(boardAiSection, /<AICustomPromptInput fillHeight \/>/);
  assert.match(promptInput, /fillHeight \? "h-full min-h-0 flex-1"/);
});

test("custom instructions save action keeps its size with neutral settings colors", () => {
  const actionRow = read(
    "src/components/Modals/AICustomPrompt/ActionRow.tsx",
  );

  assert.match(
    actionRow,
    /rounded-\[4px\] px-6 py-2\.5 font-medium leading-normal/,
  );
  assert.match(actionRow, /text-white-black/);
  assert.match(actionRow, /hover:bg-hover-active/);
  assert.match(actionRow, /className=\{customInstructionsActionButtonClass\}/);
  assert.doesNotMatch(actionRow, /bg-hypertasks-ai-purple/);
});
