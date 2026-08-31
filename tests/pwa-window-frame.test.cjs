const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/pwa-window-frame.test.cjs"), {
  interopDefault: false,
  alias: { "@": path.join(root, "src") },
});
const manifest = jiti(path.join(root, "src/app/manifest.ts")).default;
const {
  DEFAULT_THEME_PREFERENCE,
  resolveInitialThemeColor,
} = jiti(path.join(root, "src/lib/themePreferences.ts"));

test("installed PWA keeps native window controls above the app navigation", () => {
  const metadata = manifest();

  assert.equal(metadata.display, "standalone");
  assert.equal(
    metadata.display_override?.includes("window-controls-overlay") ?? false,
    false,
    "window-controls-overlay draws the app beneath the native title-bar controls",
  );
});

test("installed PWA uses the shared dark initial theme color", () => {
  const metadata = manifest();
  const initialThemeColor = resolveInitialThemeColor(DEFAULT_THEME_PREFERENCE);

  assert.equal(metadata.theme_color, initialThemeColor);
  assert.equal(metadata.background_color, initialThemeColor);
});
