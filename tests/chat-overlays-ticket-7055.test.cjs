const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const KEY = "htpr-7055-chat-overlays-ticket";
const noop = () => null;

function frame(flags, pathname) {
  const source = fs.readFileSync(path.join(root, "src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dependencies = {
    react: React,
    "next/navigation": { usePathname: () => pathname },
    "lucide-react": { ChevronLeft: noop },
    "@/components/Common/Tooltip": { __esModule: true, default: noop },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "@/hooks/useFlag": { useFlag: (key) => flags[key] ?? false, useFlagLoaded: () => true },
    "@/lib/flags/keys": {
      HTPR_6990_NARROW_SIDEBAR_WIDTH_FLAG: "htpr-6990-narrow-sidebar-width",
      HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG: KEY,
      HTPR_7074_PHONE_WORKSPACE_WIDTH_FLAG: "htpr-7074-phone-workspace-width",
    },
  };
  const exports = {};
  new Function("require", "exports", js)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports.default;
}

async function overlays(Frame, viewport, sidebar = 420) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai" });
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const reactRoot = createRoot(dom.window.document.getElementById("root"));
  try {
    window.innerWidth = viewport;
    await React.act(async () => reactRoot.render(
      React.createElement(Frame, { onOpenAIChat: noop, sidebarWidthPx: sidebar }, React.createElement("div", null, "x"))));
    return dom.window.document.querySelector("[data-ai-chat-slot]").classList.contains("fixed");
  } finally {
    await React.act(async () => reactRoot.unmount());
    global.window = previous.window;
    global.document = previous.document;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    dom.window.close();
  }
}

const base = { "htpr-6990-narrow-sidebar-width": true };
const on = { ...base, [KEY]: true };
const detail = "/detail/project-15/7055";

test("ticket page: chat overlays below sidebar + 944, pushes at or above it", async () => {
  const Frame = frame(on, detail);
  assert.equal(await overlays(Frame, 1127, 340), true, "125% zoom, 340 chat: 1127 < 1284");
  assert.equal(await overlays(Frame, 1363, 420), true);
  assert.equal(await overlays(Frame, 1364, 420), false);
  assert.equal(await overlays(Frame, 1440, 420), false, "wide window keeps the in-flow chat");
});

test("other pages keep the 768 / sidebar + 340 rule", async () => {
  const Frame = frame(on, "/board/15");
  assert.equal(await overlays(Frame, 1127, 340), false);
  assert.equal(await overlays(Frame, 767, 420), true);
  assert.equal(await overlays(Frame, 768, 420), false);
});

test("flag off: ticket page keeps the old rule", async () => {
  const Frame = frame(base, detail);
  assert.equal(await overlays(Frame, 1127, 340), false);
  assert.equal(await overlays(Frame, 767, 420), true);
  assert.equal(await overlays(Frame, 768, 420), false);
});

test("the minimum width constant matches the ticket's min widths", () => {
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  assert.match(read("src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx"), /DETAIL_PAGE_MIN_WIDTH = 944/);
});
