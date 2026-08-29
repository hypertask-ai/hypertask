// HTPR-4376: secondary text in the light themes was too pale to read. Ticket IDs
// and dates sat around 3:1 against the surfaces they render on, under the 4.5:1
// WCAG AA needs for normal-size text.
//
// The trap is that a colour can pass on the page background and still fail on a
// card, a sidebar, or a selected row. So this asserts against the WORST surface
// each theme actually paints these tokens on, not against white.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const themes = path.resolve(__dirname, "../src/styles/tailwindThemes");

const srgb = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const luminance = (hex) => {
  const [r, g, b] = srgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const tokenValue = (css, name) => {
  const m = css.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`));
  assert.ok(m, `${name} must be defined as a hex value`);
  return m[1];
};

// The surfaces each light theme paints secondary text on. The last entry in each
// list is the darkest, and therefore the one that decides whether we pass.
const SURFACES = {
  "light.css": ["#f9f9f9", "#f3f3f3", "#ececec"],
  "dia.css": ["#ffffff", "#f6f4ef", "#f1eee7", "#e9e4da"],
};

const SECONDARY_TOKENS = ["--color-text-light-gray", "--color-text-labelComponent"];

const AA_NORMAL_TEXT = 4.5;

for (const [file, surfaces] of Object.entries(SURFACES)) {
  test(`${file}: secondary text meets WCAG AA on every surface it renders on`, () => {
    const css = fs.readFileSync(path.join(themes, file), "utf8");
    for (const token of SECONDARY_TOKENS) {
      const colour = tokenValue(css, token);
      for (const surface of surfaces) {
        const ratio = contrast(colour, surface);
        assert.ok(
          ratio >= AA_NORMAL_TEXT,
          `${token} (${colour}) on ${surface} is ${ratio.toFixed(2)}:1, below the ${AA_NORMAL_TEXT}:1 AA floor for normal-size text`,
        );
      }
    }
  });

  test(`${file}: secondary text stays visibly secondary`, () => {
    // Passing AA by making it the same colour as primary text would defeat the
    // point: these tokens exist to de-emphasise IDs, dates and labels.
    const css = fs.readFileSync(path.join(themes, file), "utf8");
    const primary = tokenValue(css, "--color-white-black");
    for (const token of SECONDARY_TOKENS) {
      const colour = tokenValue(css, token);
      assert.notEqual(
        colour.toLowerCase(),
        primary.toLowerCase(),
        `${token} must remain distinct from primary text`,
      );
      assert.ok(
        luminance(colour) > luminance(primary),
        `${token} must stay lighter than primary text in a light theme`,
      );
    }
  });
}
