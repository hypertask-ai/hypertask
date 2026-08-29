const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(process.cwd(), "public/manifest.json");

test("installed PWA keeps native window controls above the app navigation", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(manifest.display, "standalone");
  assert.equal(
    manifest.display_override?.includes("window-controls-overlay") ?? false,
    false,
    "window-controls-overlay draws the app beneath the native title-bar controls",
  );
});
