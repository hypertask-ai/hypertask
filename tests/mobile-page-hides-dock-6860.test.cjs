const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.join(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, { interopDefault: true, moduleCache: false })
  : jitiModule(__filename, { interopDefault: true, cache: false });
const { shouldShowMobileDock, shouldShowMobilePrimaryDock } = jiti(
  path.join(root, "src/components/Global/mobileShellVisibility.ts"),
);

test("ticket pages hide the mobile bottom bar, like the ticket screen", () => {
  for (const pathname of ["/page/cmur49hls000005qktwd6geui", "/detail/project-15/6860"]) {
    assert.equal(shouldShowMobileDock(pathname), false, pathname);
    assert.equal(shouldShowMobilePrimaryDock(pathname), false, pathname);
  }
});

test("other screens keep the bottom bar", () => {
  for (const pathname of ["/project/15", "/calendar", "/search", "/pages", "/pagex/1"]) {
    assert.equal(shouldShowMobileDock(pathname), true, pathname);
  }
});
