const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("slash commands choose available viewport space and stay inset", () => {
  const renderer = read(
    "src/components/RTE/Extensions/SlashCommands/RenderCommands.tsx",
  );
  const list = read(
    "src/components/RTE/Extensions/SlashCommands/CommandsList.tsx",
  );

  assert.match(renderer, /placement: "auto-start"/);
  assert.match(renderer, /strategy: "fixed"/);
  assert.match(
    renderer,
    /allowedAutoPlacements: \["bottom-start", "top-start"\]/,
  );
  assert.match(
    renderer,
    /fallbackPlacements: \["bottom-start", "top-start"\]/,
  );
  assert.match(renderer, /name: "preventOverflow"/);
  assert.match(renderer, /padding: 12, altAxis: true/);
  assert.match(list, /maxHeight: "calc\(100dvh - 24px\)"/);
  assert.match(list, /min-h-0/);
  assert.match(list, /overflow-y-auto/);
});

test("mentions choose available viewport space instead of clipping above mobile editors", () => {
  const renderer = read("src/components/RTE/MentionData.js");
  const list = read("src/components/RTE/MentionList.jsx");

  assert.match(renderer, /placement: "auto-start"/);
  assert.match(renderer, /strategy: "fixed"/);
  assert.match(
    renderer,
    /allowedAutoPlacements: \["bottom-start", "top-start"\]/,
  );
  assert.match(
    renderer,
    /fallbackPlacements: \["bottom-start", "top-start"\]/,
  );
  assert.match(renderer, /name: "preventOverflow"/);
  assert.match(renderer, /padding: 12, altAxis: true/);
  assert.match(list, /max-h-\[min\(18rem,calc\(100dvh_-_24px\)\)\]/);
  assert.match(list, /overflow-y-auto/);
});
