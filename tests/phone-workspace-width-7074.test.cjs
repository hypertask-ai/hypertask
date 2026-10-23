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
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, "htpr-7055-chat-overlays-ticket"); return flags[key] === true; } },
    "@/lib/flags/keys": { HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG: "htpr-7055-chat-overlays-ticket" },
  };
  const source = fs.readFileSync(path.join(root, "src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", js)((name) => (name === "react/jsx-runtime" ? require(name) : dependencies[name]), exports);
  return exports.default;
}

const render = (flags) => renderToString(React.createElement(frame(flags), { onOpenAIChat: noop, sidebarWidthPx: 420 },
  React.createElement("div", { "data-comments": true }, "Visible comments")));

test("flags not loaded yet: narrow slots are already protected in the first server render", () => {
  const slot = new JSDOM(render({})).window.document.querySelector("[data-ai-chat-slot]");
  assert.ok(slot.classList.contains("max-md:fixed"));
});

test("phone flag loaded Off still protects narrow slots", () => {
  const slot = new JSDOM(render({ [phoneKey]: false })).window.document.querySelector("[data-ai-chat-slot]");
  assert.equal(slot.className, "shrink-0 max-md:fixed max-md:right-0 max-md:top-0 max-md:z-[51]");
});

test("flag On: the reserved slot is out of flow below md and still shrink-0 above", () => {
  const slot = new JSDOM(render({ [phoneKey]: true })).window.document.querySelector("[data-ai-chat-slot]");
  assert.ok(slot.classList.contains("shrink-0"));
  for (const c of ["max-md:fixed", "max-md:right-0", "max-md:top-0"]) assert.ok(slot.classList.contains(c), c);
  assert.equal(slot.style.width, "420px");
});

test("permanent narrow-sidebar protection keeps its classes whatever the phone flag says", () => {
  const a = new JSDOM(render({ [phoneKey]: false })).window.document.querySelector("[data-ai-chat-slot]").className;
  const b = new JSDOM(render({ [phoneKey]: true })).window.document.querySelector("[data-ai-chat-slot]").className;
  assert.equal(a, b);
});

test("rendered widths: workspace is always full width below md and reserves chat width on desktop", { skip: !fs.existsSync(chromium.executablePath()) && "Playwright browser not installed" }, async (t) => {
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
      const expected = viewport < 768 ? viewport : Math.max(0, viewport - 420);
      assert.equal(main, expected, `phone flag ${phoneOn ? "on" : "off"} at ${viewport}px`);
    }
  }
});
