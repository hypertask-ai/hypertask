const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const sass = require("sass");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { normalizeAssistantHtml } = jiti(
  path.join(root, "src/utils/helperFunctions/normalizeAssistantHtml.ts"),
);
const { resolveThemePreference } = jiti(path.join(root, "src/lib/themePreferences.ts"));
const messageStyles = sass.compile(path.join(root, "src/styles/messageItem.scss")).css;
const themes = [
  "light", "dark", "porcelain", "graphite", "amoled", "dia",
  resolveThemePreference("system", "light"),
  resolveThemePreference("system", "dark"),
];
const samples = [
  ["bash", "npm install"],
  ["json", '{"ready":true}'],
  ["sql", "SELECT * FROM tasks;"],
];

function renderMessage(theme, markdown) {
  const themeStyles = fs.readFileSync(
    path.join(root, `src/styles/tailwindThemes/${theme}.css`), "utf8",
  );
  return new JSDOM(`<!doctype html><html class="${theme}"><head>
    <style>${themeStyles}</style><style>${messageStyles}</style></head><body>
    <div class="submessage-container"><div class="content-container">
      <div class="content-html">${normalizeAssistantHtml(markdown)}</div>
    </div></div></body></html>`);
}

function luminance(window, color) {
  const probe = window.document.createElement("span");
  probe.style.color = color;
  window.document.body.append(probe);
  const rgb = window.getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3);
  probe.remove();
  const [r, g, b] = rgb.map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(window, foreground, background) {
  const values = [foreground, background].map((color) => luminance(window, color));
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

test("AI chat fenced and inline code use a readable theme token pair in every theme", () => {
  for (const theme of themes) {
    const markdown = "Use `npm install`.\n\n" + samples
      .map(([language, code]) => `\`\`\`${language}\n${code}\n\`\`\``).join("\n\n");
    const dom = renderMessage(theme, markdown);
    try {
      const { window } = dom;
      const { document } = window;
      const tokens = window.getComputedStyle(document.documentElement);
      const foreground = tokens.getPropertyValue("--color-white-black").trim();
      const background = tokens.getPropertyValue("--bg-comment-description").trim();
      assert.ok(contrast(window, foreground, background) >= 4.5, `${theme}: code contrast`);
      assert.ok(contrast(window, "white", "#f5f5f5") < 4.5, "the original white-on-light control fails AA");
      assert.equal(document.querySelectorAll("pre").length, 3);
      assert.equal(document.querySelectorAll("code").length, 4);
      for (const element of document.querySelectorAll("pre, code")) {
        const style = window.getComputedStyle(element);
        assert.equal(style.color, "var(--color-white-black)", `${theme}: ${element.tagName} text`);
        assert.equal(style.backgroundColor, "var(--bg-comment-description)", `${theme}: ${element.tagName} surface`);
      }
    } finally {
      dom.window.close();
    }
  }
});

test("AI chat still preserves code content, monospace and contained horizontal scrolling", () => {
  const command = `printf '%s' '${"long-line-".repeat(100)}'`;
  const dom = renderMessage("porcelain", `Use \`npm install\`.\n\n\`\`\`bash\n${command}\n\`\`\``);
  try {
    const { window } = dom;
    const { document } = window;
    const block = document.querySelector("pre");
    const code = block.querySelector("code");
    const style = window.getComputedStyle(block);
    assert.equal(code.textContent, `${command}\n`);
    assert.equal(document.querySelector("p code").textContent, "npm install");
    assert.equal(window.getComputedStyle(code).fontFamily, "monospace");
    assert.equal(window.getComputedStyle(document.querySelector("p code")).fontFamily, "monospace");
    assert.equal(style.whiteSpace, "pre");
    assert.equal(style.overflowX, "auto");
    assert.equal(style.overflowY, "hidden");
    assert.equal(style.maxWidth, "100%");
    assert.equal(window.getComputedStyle(document.querySelector(".content-html")).overflowX, "hidden");
  } finally {
    dom.window.close();
  }
});
