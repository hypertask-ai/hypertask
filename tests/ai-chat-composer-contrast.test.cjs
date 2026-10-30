const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const themes = path.resolve(__dirname, "../src/styles/tailwindThemes");

const luminance = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(full.slice(i, i + 2), 16))
    .map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const tokenValue = (file, name) => {
  const css = fs.readFileSync(path.join(themes, file), "utf8");
  const m = css.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`));
  assert.ok(m, `${name} must be a hex value in ${file}`);
  return m[1];
};

const composerSeparation = (file) =>
  contrast(
    tokenValue(file, "--bg-ai-chat-tiptap"),
    tokenValue(file, "--bg-ai-chat"),
  );

test("AMOLED composer is at least as visible as the dark theme's composer", () => {
  const amoled = composerSeparation("amoled.css");
  const dark = composerSeparation("dark.css");

  assert.ok(
    amoled >= dark,
    `AMOLED composer separation ${amoled.toFixed(3)}:1 is below dark's ${dark.toFixed(3)}:1`,
  );
});

test("AMOLED composer is not the same colour as the chat background", () => {
  assert.notEqual(
    tokenValue("amoled.css", "--bg-ai-chat-tiptap").toLowerCase(),
    tokenValue("amoled.css", "--bg-ai-chat").toLowerCase(),
  );
});
