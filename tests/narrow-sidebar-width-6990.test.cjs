const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { chromium } = require("@playwright/test");
const { compile } = require("@tailwindcss/node");
const root = path.resolve(__dirname, "..");
const flagKey = "htpr-6990-narrow-sidebar-width";
const phoneFlagKey = "htpr-7074-phone-workspace-width";
const noop = () => null;

function frame(enabled, mobile = false, pathname = "/detail/project-15/6990", phoneEnabled = false) {
  const dependencies = {
    react: React,
    "next/navigation": { usePathname: () => pathname },
    "lucide-react": { ChevronLeft: noop },
    "@/components/Common/Tooltip": { __esModule: true, default: noop },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "@/hooks/useFlag": { useFlag: (key) => { assert.ok([flagKey, phoneFlagKey, "htpr-7055-chat-overlays-ticket"].includes(key)); return key === flagKey ? enabled : key === phoneFlagKey ? phoneEnabled : false; }, useFlagLoaded: () => true },
    "@/lib/flags/keys": { HTPR_6990_NARROW_SIDEBAR_WIDTH_FLAG: flagKey, HTPR_7074_PHONE_WORKSPACE_WIDTH_FLAG: phoneFlagKey, HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG: "htpr-7055-chat-overlays-ticket" },
  };
  const source = fs.readFileSync(path.join(root, "src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports.default;
}

function workspace(Frame, width = 420, panels) {
  return React.createElement(Frame, { onOpenAIChat: noop, sidebarWidthPx: width, panels },
    React.createElement("div", { "data-comments": true }, "Visible comments"));
}

async function styles(html) {
  const document = new JSDOM(html).window.document;
  const candidates = [...new Set([...document.querySelectorAll("[class]")].flatMap((node) => [...node.classList]))];
  const compiler = await compile('@import "tailwindcss";', { base: root, onDependency: noop });
  return compiler.build(candidates);
}

const browserInstalled = fs.existsSync(chromium.executablePath());

test("narrow desktop reserves no chat width even before viewport hydration, while wide desktops keep the no-jump slot", { skip: !browserInstalled && "Playwright browser not installed" }, async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  for (const enabled of [false, true]) {
    for (const panels of [undefined, React.createElement("aside", { style: { width: 420, position: "fixed", right: 0 } }, "Chat")]) {
      const html = renderToString(workspace(frame(enabled), 420, panels));
      const css = await styles(html);
      for (const viewport of [390, 767, 768, 1024, 1440]) {
        await page.setViewportSize({ width: viewport, height: 844 });
        await page.setContent(`<style>${css}body{margin:0}</style>${html}`);
        const measurements = await page.evaluate(() => ({
          main: document.querySelector("[data-ai-workspace]").getBoundingClientRect().width,
          slot: document.querySelector("[data-ai-chat-slot]").getBoundingClientRect().width,
          comments: document.querySelector("[data-comments]").textContent,
        }));
        const reserved = enabled && viewport < 768 ? 0 : 420;
        assert.equal(measurements.main, Math.max(0, viewport - reserved), `${enabled ? "on" : "off"} at ${viewport}px`);
        assert.equal(measurements.slot, 420, "wide sidebar reservation does not change when chunks load");
        assert.equal(measurements.comments, "Visible comments");
      }
    }
  }
});

test("flag Off retains the original desktop slot and mobile closed-ticket path", () => {
  const desktop = new JSDOM(renderToString(workspace(frame(false)))).window.document;
  const slot = desktop.querySelector("[data-ai-chat-slot]");
  assert.equal(slot.className, "shrink-0");
  assert.equal(slot.style.width, "420px");
  for (const enabled of [false, true]) {
    const mobile = new JSDOM(renderToString(workspace(frame(enabled, true)))).window.document;
    assert.equal(mobile.querySelector("[data-ai-chat-slot]"), null);
    assert.ok(mobile.querySelector("[data-comments]"));
    if (enabled) {
      const desktop = new JSDOM(renderToString(workspace(frame(true)))).window.document;
      assert.ok(desktop.querySelector("[data-ai-chat-slot]").classList.contains("max-md:fixed"), "CSS protects the initial desktop-UA render before viewport hydration");
    }
    const closed = new JSDOM(renderToString(workspace(frame(enabled), 0))).window.document;
    assert.equal(closed.querySelector("[data-ai-chat-slot]").className, "contents");
    assert.equal(closed.querySelector("[data-ai-chat-slot]").style.width, "");
  }
});

test("oversized persisted sidebars overlay instead of squeezing content and resize without remounting comments", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai" });
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  t.after(async () => {
    await React.act(async () => reactRoot.unmount());
    global.window = previous.window;
    global.document = previous.document;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    dom.window.close();
  });
  window.innerWidth = 1440;
  const Frame = frame(true);
  await React.act(async () => reactRoot.render(workspace(Frame, 600, React.createElement("aside", null, "Chat"))));
  const comments = container.querySelector("[data-comments]");
  for (const [viewport, overlay] of [[800, true], [939, true], [940, false], [1440, false], [390, true]]) {
    await React.act(async () => {
      window.innerWidth = viewport;
      window.dispatchEvent(new window.Event("resize"));
    });
    const slot = container.querySelector("[data-ai-chat-slot]");
    assert.equal(slot.classList.contains("fixed"), overlay, `${viewport}px leaves at least 340px or overlays`);
    assert.equal(container.querySelector("[data-comments]"), comments);
  }
  window.innerWidth = 800;
  await React.act(async () => reactRoot.render(workspace(Frame, 420)));
  assert.equal(container.querySelector("[data-ai-chat-slot]").classList.contains("fixed"), false, "changing saved width recalculates reservation");
});
