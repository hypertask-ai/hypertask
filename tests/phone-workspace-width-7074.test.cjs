const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { chromium } = require("@playwright/test");
const { compile } = require("@tailwindcss/node");

const root = path.resolve(__dirname, "..");
const narrowKey = "htpr-6990-narrow-sidebar-width";
const phoneKey = "htpr-7074-phone-workspace-width";
const noop = () => null;

function frame(flags) {
  const dependencies = {
    react: React,
    "next/navigation": { usePathname: () => "/detail/project-15/7074" },
    "lucide-react": { ChevronLeft: noop },
    "@/components/Common/Tooltip": { __esModule: true, default: noop },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "@/hooks/useFlag": { useFlag: (key) => flags[key] === true, useFlagLoaded: (key) => Object.hasOwn(flags, key) },
    "@/lib/flags/keys": { HTPR_6990_NARROW_SIDEBAR_WIDTH_FLAG: narrowKey, HTPR_7074_PHONE_WORKSPACE_WIDTH_FLAG: phoneKey },
  };
  const source = fs.readFileSync(path.join(root, "src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", js)((name) => (name === "react/jsx-runtime" ? require(name) : dependencies[name]), exports);
  return exports.default;
}

const render = (flags) => renderToString(React.createElement(frame(flags), { onOpenAIChat: noop, sidebarWidthPx: 420 },
  React.createElement("div", { "data-comments": true }, "Visible comments")));

test("flags not loaded yet: the fix is already in the first server render", () => {
  const slot = new JSDOM(render({})).window.document.querySelector("[data-ai-chat-slot]");
  assert.ok(slot.classList.contains("max-md:fixed"));
});

test("flag loaded Off keeps today's in-flow slot class", () => {
  const slot = new JSDOM(render({ [phoneKey]: false })).window.document.querySelector("[data-ai-chat-slot]");
  assert.equal(slot.className, "shrink-0");
});

test("flag On: the reserved slot is out of flow below md and still shrink-0 above", () => {
  const slot = new JSDOM(render({ [phoneKey]: true })).window.document.querySelector("[data-ai-chat-slot]");
  assert.ok(slot.classList.contains("shrink-0"));
  for (const c of ["max-md:fixed", "max-md:right-0", "max-md:top-0"]) assert.ok(slot.classList.contains(c), c);
  assert.equal(slot.style.width, "420px");
});

test("the existing narrow-sidebar flag keeps its own classes whatever the phone flag says", () => {
  const a = new JSDOM(render({ [narrowKey]: true })).window.document.querySelector("[data-ai-chat-slot]").className;
  const b = new JSDOM(render({ [narrowKey]: true, [phoneKey]: true })).window.document.querySelector("[data-ai-chat-slot]").className;
  assert.equal(a, b);
});

test("rendered widths: workspace is full width on a phone with the flag, 0 without; desktop identical", { skip: !fs.existsSync(chromium.executablePath()) && "Playwright browser not installed" }, async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  for (const phoneOn of [false, true]) {
    const html = render({ [phoneKey]: phoneOn });
    const document = new JSDOM(html).window.document;
    const candidates = [...new Set([...document.querySelectorAll("[class]")].flatMap((n) => [...n.classList]))];
    const css = (await (await compile('@import "tailwindcss";', { base: root, onDependency: noop })).build(candidates));
    for (const viewport of [390, 767, 768, 1440]) {
      await page.setViewportSize({ width: viewport, height: 844 });
      await page.setContent(`<style>${css}body{margin:0}</style>${html}`);
      const main = await page.evaluate(() => document.querySelector("[data-ai-workspace]").getBoundingClientRect().width);
      const expected = viewport < 768 && phoneOn ? viewport : Math.max(0, viewport - 420);
      assert.equal(main, expected, `phone flag ${phoneOn ? "on" : "off"} at ${viewport}px`);
    }
  }
});
