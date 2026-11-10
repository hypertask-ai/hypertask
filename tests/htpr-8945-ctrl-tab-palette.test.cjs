const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename);

test("HTPR-8945 flag is a small bugfix defaulting to Everyone", () => {
  const { default: flag, HTPR_8945_CTRL_TAB_PALETTE_FLAG: key } = jiti(
    path.join(root, "src/lib/flags/definitions/htpr-8945-ctrl-tab-palette.ts"),
  );
  assert.equal(key, "htpr-8945-ctrl-tab-palette");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
});
