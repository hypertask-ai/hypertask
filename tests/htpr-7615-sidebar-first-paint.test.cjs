const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const noop = () => null;

function load(file, mocks = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", js)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    assert.ok(name.startsWith("react"), `Unexpected dependency ${name}`);
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports;
}

const { buildTicketSidebarBootScript, TICKET_SIDEBAR_BOOT_CSS } = load("src/lib/ticketSidebarBoot.ts", {
  "@/lib/configs/style.config": load("src/lib/configs/style.config.ts"),
});
const flags = { keepClosed: true, overlayTicket: true };

function firstPaint(saved, { viewport = 1440, pathname = "/detail/project-8190/26", modes = flags, blocked = false } = {}) {
  const { default: Frame } = load("src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx", {
    react: React,
    "next/navigation": { usePathname: () => pathname },
    "lucide-react": { ChevronLeft: noop },
    "@/components/Common/Tooltip": { __esModule: true, default: noop },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "@/hooks/useFlag": { useFlag: () => false, useFlagLoaded: () => false, useFlagReady: () => true },
    "@/lib/flags/definitions/htpr-8038-chat-opener-ready": { HTPR_8038_CHAT_OPENER_READY_FLAG: "htpr-8038-chat-opener-ready" },
    "@/lib/flags/keys": {},
  });
  const html = renderToString(React.createElement(Frame, { onOpenAIChat: noop, sidebarWidthPx: 420 },
    React.createElement("div", { id: "body" }, "Existing ticket")));
  return new JSDOM(`<html><head><style>${TICKET_SIDEBAR_BOOT_CSS}</style><script>${buildTicketSidebarBootScript(modes)}</script></head><body>${html}</body></html>`, {
    url: `https://app.hypertask.ai${pathname}`, runScripts: "dangerously",
    beforeParse(window) {
      window.innerWidth = viewport;
      if (blocked) Object.defineProperty(window, "localStorage", { get() { throw Error("Storage blocked"); } });
      else if (saved !== undefined) window.localStorage.setItem("recoil-persist", typeof saved === "string" ? saved : JSON.stringify(saved));
    },
  });
}

test("the first painted slot uses the saved closed state before React hydrates, not its 420px default", () => {
  const dom = firstPaint({ aiChatAutoOpenSuppressed: true, aiChatPinned: false, aiChatSidebarWidthPx: 517 });
  try {
    const { document } = dom.window;
    assert.equal(document.documentElement.dataset.ticketSidebar, "closed");
    assert.equal(dom.window.getComputedStyle(document.querySelector("[data-ai-chat-slot]")).display, "contents");
    assert.equal(document.querySelector("#body").textContent, "Existing ticket", "real ticket content is never hidden or delayed");
    assert.equal(document.querySelector("[data-ai-chat-slot]").style.width, "420px", "React's server markup is unchanged for hydration");
  } finally { dom.window.close(); }
});

test("saved expanded widths, pinning, floating mode and existing flag modes determine the initial reservation", () => {
  for (const [saved, options, expected, width] of [
    [{}, {}, "reserved", 420],
    [{ aiChatSidebarWidthPx: 517 }, { viewport: 1600 }, "reserved", 517],
    [{ aiChatSidebarWidthPx: 280 }, {}, "reserved", 340],
    [{ aiChatSidebarWidthPx: 600 }, {}, "overlay", 600],
    [{ aiChatSidebarWidthPx: 600 }, { modes: { ...flags, overlayTicket: false } }, "reserved", 600],
    [{ aiChatPinned: true, aiChatAutoOpenSuppressed: true }, {}, "reserved", 420],
    [{ openAiChatByDefault: false }, {}, "closed", 420],
    [{ isAiChatSidebarMode: false }, {}, "closed", 420],
    [{ keepAiChatClosed: true, aiChatPinned: true }, {}, "closed", 420],
    [{ keepAiChatClosed: true }, { modes: { ...flags, keepClosed: false } }, "reserved", 420],
  ]) {
    const dom = firstPaint(saved, options);
    try {
      assert.equal(dom.window.document.documentElement.dataset.ticketSidebar, expected, JSON.stringify({ saved, options }));
      assert.equal(dom.window.document.documentElement.style.getPropertyValue("--ticket-sidebar-width"), `${width}px`);
      const rules = [...dom.window.document.styleSheets[0].cssRules];
      const reservation = rules.find(rule => rule.selectorText === "html[data-ticket-sidebar] [data-ai-chat-slot]");
      assert.equal(reservation.style.getPropertyValue("width"), "var(--ticket-sidebar-width)");
      assert.equal(reservation.style.getPropertyPriority("width"), "important", "the boot width must beat React's inline default");
    } finally { dom.window.close(); }
  }
});

test("phone, other routes, malformed and blocked storage keep their existing layout", () => {
  for (const [saved, options] of [
    [{ aiChatSidebarWidthPx: 517 }, { viewport: 390 }],
    [{ aiChatSidebarWidthPx: 517 }, { pathname: "/project?id=15" }],
    ["{", {}], ["null", {}], ["[]", {}], [undefined, { blocked: true }],
  ]) {
    const dom = firstPaint(saved, options);
    try { assert.equal(dom.window.document.documentElement.hasAttribute("data-ticket-sidebar"), false); }
    finally { dom.window.close(); }
  }
});

test("the display mirror hands layout back on hydration even when a related flag never reports ready", () => {
  for (const hydrated of [false, true]) {
    const dom = firstPaint({ aiChatAutoOpenSuppressed: true });
    const previousDocument = global.document;
    const layouts = [];
    try {
      global.document = dom.window.document;
      const { default: Mirror } = load("src/lib/firstScreen/BoardDisplayMirror.tsx", {
        react: { useEffect: noop, useLayoutEffect: callback => layouts.push(callback) },
        "@/hooks/useFlag": { useFlag: () => false, useFlagReady: () => false },
        "@/hooks/General/useHydrated": { useHydrated: () => hydrated },
        "@/lib/state": { useRecoilValue: () => ({}) }, "@/store": {}, "@/lib/flags/keys": {},
        "./boardDocument": {}, "./boardDisplay": {},
      });
      assert.equal(Mirror({ accountId: 985 }), null);
      layouts.forEach(callback => callback());
      assert.equal(document.documentElement.hasAttribute("data-ticket-sidebar"), !hydrated);
      if (hydrated) assert.equal(document.documentElement.style.getPropertyValue("--ticket-sidebar-width"), "");
    } finally {
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
      dom.window.close();
    }
  }
});

test("HTPR-7615 registers a reversible Everyone bugfix", () => {
  const definition = require("jiti").createJiti(__filename, { interopDefault: true })(path.join(root, "src/lib/flags/definitions/htpr-7615-sidebar-first-paint.ts"));
  assert.equal(definition.key, "htpr-7615-sidebar-first-paint");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
