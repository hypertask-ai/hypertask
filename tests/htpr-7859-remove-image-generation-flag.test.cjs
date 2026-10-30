const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const { default: flag, HTPR_7859_REMOVE_IMAGE_GENERATION_FLAG } = jiti(path.join(root, "src/lib/flags/definitions/htpr-7859-remove-image-generation.ts"));

test("image removal ships for everyone and can be reversed", () => {
  assert.equal(flag.key, HTPR_7859_REMOVE_IMAGE_GENERATION_FLAG);
  assert.equal(flag.key, "htpr-7859-remove-image-generation");
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
});
