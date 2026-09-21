const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// 2026-09-21 incident: Providers cleared global-error's reload budget on every
// mount, so a tree that mounted and then threw (a hydration mismatch) refilled
// its own budget and the tab reloaded forever. The budget may only be cleared
// once the tree has stayed mounted for the stability window.
test("root reload budget is only cleared after the tree stayed mounted", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/utils/Providers.tsx"),
    "utf8",
  );
  const budgetReset = source.indexOf('removeItem("ht-root-reload")');
  const stableTimer = source.indexOf("window.setTimeout(() => {", 0);
  const stableEnd = source.indexOf("CHUNK_RECOVERY_STABLE_MS);", stableTimer);
  assert.ok(budgetReset > 0, "Providers must still clear the reload budget");
  assert.ok(stableTimer > 0 && stableEnd > stableTimer, "stability timer present");
  assert.ok(
    budgetReset > stableTimer && budgetReset < stableEnd,
    "ht-root-reload must be cleared inside the stability timer, never on bare mount",
  );
});
