// HTPR-5196: Manage Columns had 8px edit-view gutters and two Bootstrap
// switches whose chrome drifted from Hypertask's themed settings controls.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manageColumns = fs.readFileSync(
  path.join(root, "src/components/Modals/commands/manageColumn.tsx"),
  "utf8",
);
const settingsToggle = fs.readFileSync(
  path.join(root, "src/components/Modals/Settings/SettingsToggle.tsx"),
  "utf8",
);

test("Manage Columns uses the shared themed switch for both boolean settings", () => {
  assert.match(manageColumns, /import SettingsToggle from/);
  assert.equal(
    manageColumns.match(/<SettingsToggle/g)?.length,
    2,
    "the header and finished-column settings should share one switch pattern",
  );
  assert.doesNotMatch(manageColumns, /form-check-input|form-switch/);

  assert.match(settingsToggle, /bg-hypertasks-green/);
  assert.match(settingsToggle, /bg-hover-active/);
  assert.match(settingsToggle, /border-border-light-gray-thin/);
  assert.match(settingsToggle, /border-\[1px\] border-border-light-gray-thin/);
  assert.doesNotMatch(
    settingsToggle,
    /\bborder border-border-light-gray-thin/,
    "Bootstrap's global .border !important rule must not override the theme token",
  );
});

test("the shared switch keeps button semantics and visible keyboard focus", () => {
  assert.match(settingsToggle, /htmlFor={inputId}/);
  assert.match(settingsToggle, /aria-checked={checked}/);
  assert.match(settingsToggle, /aria-label={label}/);
  assert.match(settingsToggle, /id={inputId}/);
  assert.match(settingsToggle, /role="switch"/);
  assert.match(settingsToggle, /type="button"/);
  assert.match(settingsToggle, /focus-visible:outline-container-outline/);
  assert.doesNotMatch(settingsToggle, /focus-visible:outline-none/);
  assert.match(
    settingsToggle,
    /h-6 w-10/,
    "the activation target should remain at least 24px tall",
  );
});

test("the edit view keeps a 16px horizontal content gutter", () => {
  const editViewStart = manageColumns.indexOf("One row per setting");
  const editViewEnd = manageColumns.indexOf(
    "DELETE CONFIRM MODAL",
    editViewStart,
  );
  assert.ok(editViewStart >= 0, "the edit view marker must exist");
  assert.ok(editViewEnd > editViewStart, "the edit view end marker must exist");
  const editView = manageColumns.slice(editViewStart, editViewEnd);

  assert.match(editView, /edit-column-name[\s\S]*?px-4 py-2/);
  assert.match(editView, /Auto-assign[\s\S]*?px-4 py-2/);
  assert.match(editView, /Danger zone/);
  assert.match(editView, /px-4 pt-5/);
  assert.match(editView, /border-t[\s\S]*?px-4 py-2/);
});

for (const theme of ["light", "dark"]) {
  test(`${theme} theme defines the shared switch surface and border tokens`, () => {
    const css = fs.readFileSync(
      path.join(root, `src/styles/tailwindThemes/${theme}.css`),
      "utf8",
    );
    assert.match(css, /--bg-hover-active\s*:\s*[^;]+;/);
    assert.match(css, /--border-light-gray-thin\s*:\s*[^;]+;/);
    assert.match(css, /--focus-ring\s*:\s*[^;]+;/);
  });
}
