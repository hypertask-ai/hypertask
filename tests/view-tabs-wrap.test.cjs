const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "../src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx",
  ),
  "utf8",
);

test("app-shell view splits wrap without horizontal controls", () => {
  assert.match(
    source,
    /\? 'flex min-w-0 flex-1 flex-wrap items-center gap-\[9px\]'/,
  );
  assert.match(source, /if \(!el \|\| isMbl \|\| appShellRail\) return/);
  assert.match(source, /if \(appShellRail\) return/);
  assert.match(source, /!appShellRail && canScrollLeft/);
  assert.match(source, /!appShellRail && canScrollRight/);
  assert.match(
    source,
    /max-w-full min-w-0 items-center justify-start gap-1 whitespace-nowrap/,
  );
  assert.doesNotMatch(
    source,
    /max-w-full min-w-0 items-center justify-start gap-1 overflow-hidden/,
  );
  assert.ok(
    source.includes(
      "footer_tags min-w-0 max-w-[min(18rem,calc(100vw-8rem))] truncate",
    ),
  );
});
