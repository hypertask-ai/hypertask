const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, { interopDefault: true, moduleCache: false })
  : jitiModule(__filename, { interopDefault: true, cache: false });
const { isTicketPagePath } = jiti(
  path.join(root, "src/components/Global/mobileShellVisibility.ts"),
);

test("only ticket page routes count as ticket pages", () => {
  assert.equal(isTicketPagePath("/page/cmur49hls000005qktwd6geui"), true);
  for (const pathname of ["/pages", "/pagex/1", "/project/15", "/detail/project-15/6860", null]) {
    assert.equal(isTicketPagePath(pathname), false, String(pathname));
  }
});

test("the bottom bar and its inset hide on ticket pages only behind the HTPR-6860 flag", () => {
  const keys = read("src/lib/flags/keys.ts");
  assert.match(keys, /HTPR_6860_MOBILE_PAGE_HIDE_DOCK_FLAG =\s*"htpr-6860-mobile-page-hide-dock"/);
  const shell = read("src/components/ProviderGlobal/GloablProviders.tsx");
  assert.match(shell, /!\(mobilePageHideDockFlag && isTicketPagePath\(pathname\)\) &&/);
  assert.match(shell, /mobilePageHideDockFlag && isTicketPagePath\(pathname\) \? null : \(\s*<MobileTabBar/);
  assert.match(shell, /useFlag\(HTPR_6860_MOBILE_PAGE_HIDE_DOCK_FLAG\)/);
});
