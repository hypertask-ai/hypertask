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

test("the bottom bar hides on ticket pages without a flag", () => {
  const shell = read("src/components/ProviderGlobal/GloablProviders.tsx");
  const reservations = read("src/hooks/General/usePageLoadReservations.ts");
  assert.match(reservations, /!isTicketPagePath\(pathname\) &&/);
  assert.doesNotMatch(reservations + shell, /mobilePageHideDock/);
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions/htpr-6860-mobile-page-hide-dock.ts")), false);
});
