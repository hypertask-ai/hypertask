const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");

test("the bugfix flag is on for everyone by default", () => {
  const jiti = createJiti(__filename);
  const flag = jiti(path.join(root, "src/lib/flags/definitions/htpr-7695-column-reveal-ahead.ts")).default;
  assert.equal(flag.key, "htpr-7695-column-reveal-ahead");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
});
