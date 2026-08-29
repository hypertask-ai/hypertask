// HTPR-5198: the desktop Share Task modal used a hard-coded light green for
// its temporary "Copied" state. On the light theme's gray button, that was
// only 1.33:1 contrast. The copied state already has a check icon and label,
// so both states should retain the theme-aware primary foreground token.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const modalPath = path.join(
  root,
  "src/components/Modals/ShareTaskModal/index.tsx",
);
const themesPath = path.join(root, "src/styles/tailwindThemes");

const srgb = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const luminance = (hex) => {
  const [r, g, b] = srgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const normalizeColor = (value) =>
  value.toLowerCase() === "white" ? "#ffffff" : value;

const tokenValue = (css, name) => {
  const match = css.match(
    new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8}|white)\\s*;`),
  );
  assert.ok(match, `${name} must be defined as a concrete color`);
  return normalizeColor(match[1]);
};

test("desktop copied feedback keeps the theme-aware foreground", () => {
  const source = fs.readFileSync(modalPath, "utf8");
  const shareRow = source.slice(source.indexOf("const ShareRow ="));
  const copyButton = shareRow.slice(
    shareRow.indexOf("<button"),
    shareRow.indexOf("</button>") + "</button>".length,
  );

  assert.match(copyButton, /bg-active-modal-element/);
  assert.match(copyButton, /text-white-black/);
  assert.doesNotMatch(copyButton, /#[0-9a-fA-F]{3,8}/);
  assert.doesNotMatch(copyButton, /copied\s*&&/);
  assert.match(copyButton, /copied \? "Copied" : "Copy"/);
});

for (const file of fs
  .readdirSync(themesPath)
  .filter((name) => name.endsWith(".css"))) {
  test(`${file}: copy feedback meets WCAG AA on its button surface`, () => {
    const css = fs.readFileSync(path.join(themesPath, file), "utf8");
    const foreground = tokenValue(css, "--color-white-black");
    const background = tokenValue(css, "--active-modal-element");
    const ratio = contrast(foreground, background);

    assert.ok(
      ratio >= 4.5,
      `${foreground} on ${background} is ${ratio.toFixed(2)}:1, below the 4.5:1 WCAG AA floor`,
    );
  });
}
