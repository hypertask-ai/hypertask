const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { fsCache: false });
const writer = fs.readFileSync(path.join(root, "src/components/Modals/commands/HTC/ComposeTaskWriter.tsx"), "utf8");
const { resolveComposeBoardTarget } = jiti(path.join(root, "src/components/Modals/commands/HTC/composeBoardTarget.ts"));
const definition = jiti(path.join(root, "src/lib/flags/definitions/htpr-7313-ctrlj-always-board-chip.ts")).default;

function chipDecisionBlock() {
  const start = writer.indexOf("if (boardChipEnabled) {\n    const target = resolveComposeBoardTarget(");
  assert.ok(start > 0, "board chip decision block not found");
  return writer.slice(start, writer.indexOf("\n  }", start));
}

function showChipFor(url, alwaysShowBoardChip) {
  const target = resolveComposeBoardTarget({ url, lastUsedBoardId: 7 });
  let showBoardChip = target.showChip;
  const flagBranch = chipDecisionBlock().match(/\n\s*if \(alwaysShowBoardChip\) showBoardChip = true;/);
  if (flagBranch && alwaysShowBoardChip) showBoardChip = true;
  return { boardId: target.boardId, showBoardChip };
}

test("flag ships on for Everyone and is read with useFlag", () => {
  assert.equal(definition.key, "htpr-7313-ctrlj-always-board-chip");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.match(writer, /const alwaysShowBoardChip = useFlag\(HTPR_7313_CTRLJ_ALWAYS_BOARD_CHIP_FLAG\);/);
});

test("flag on: board and ticket pages show the chip with their own board", () => {
  for (const url of ["/project?id=8", "/project/8", "/detail/project-8/12"]) {
    assert.deepEqual(showChipFor(url, true), { boardId: 8, showBoardChip: true });
  }
});

test("flag off: board and ticket pages keep hiding the chip; inbox and mixed views unchanged either way", () => {
  for (const url of ["/project?id=8", "/detail/project-8/12"]) {
    assert.deepEqual(showChipFor(url, false), { boardId: 8, showBoardChip: false });
  }
  for (const url of ["/inbox", "/search", "/my-tasks"]) {
    assert.deepEqual(showChipFor(url, true), showChipFor(url, false));
  }
});

test("the flag only widens visibility inside the existing board chip flag", () => {
  const block = chipDecisionBlock();
  assert.ok(block.indexOf("showBoardChip = target.showChip;") < block.indexOf("if (alwaysShowBoardChip) showBoardChip = true;"));
  assert.match(writer, /\{boardChipEnabled && showBoardChip && <div/);
});
