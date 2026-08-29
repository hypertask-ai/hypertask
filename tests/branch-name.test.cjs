const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
});
const { buildBranchName } = jiti(
  path.join(root, "src/utils/branchName.ts")
);

test("builds a lowercase ticket branch with a normalized title slug", () => {
  assert.equal(
    buildBranchName("HTPR-1234", "Fix the login redirect"),
    "htpr-1234-fix-the-login-redirect"
  );
  assert.equal(
    buildBranchName("HTPR-1234", "  Fix: login / redirect!!!  "),
    "htpr-1234-fix-login-redirect"
  );
});

test("caps the title slug at 50 characters without a trailing hyphen", () => {
  const branchName = buildBranchName(
    "HTPR-1234",
    "This title is intentionally long enough to pass the branch slug limit"
  );
  const slug = branchName.slice("htpr-1234-".length);

  assert.equal(slug.length, 50);
  assert.equal(slug.endsWith("-"), false);
});
