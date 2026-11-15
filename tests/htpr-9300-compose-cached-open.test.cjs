const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const { openSavedComposeTask } = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));

test("a saved Ctrl+J task opens from the copy already in hand", () => {
  let cached = 0;
  assert.equal(openSavedComposeTask(true, () => {
    cached += 1;
    return true;
  }), true);
  assert.equal(cached, 1);
});

test("the flag off leaves the full page open in charge", () => {
  let cached = 0;
  assert.equal(openSavedComposeTask(false, () => {
    cached += 1;
    return true;
  }), false);
  assert.equal(cached, 0);
});

test("a cache miss still needs the full page open", () => {
  assert.equal(openSavedComposeTask(true, () => false), false);
});
