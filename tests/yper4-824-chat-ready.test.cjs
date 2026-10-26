const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { hydrateRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loader } = require("./helpers/htpr-7260-ui.cjs");

test("chat readiness waits for hydration and a working Open callback", async () => {
  const load = loader({
    "next/navigation": { usePathname: () => "/project" },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": { HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG: "overlay" },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/components/Common/Tooltip": { default: () => null },
  });
  const Frame = load("src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx").default;
  let opened = 0;
  const element = React.createElement(Frame, { onOpenAIChat: () => { opened++; } }, "Board");
  const html = renderToString(element);
  const dom = new JSDOM(`<div id="root">${html}</div>`, { url: "https://app.hypertask.ai/project?id=1" });
  const values = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(global, key, { value, configurable: true, writable: true });
  const container = document.getElementById("root");
  let root;
  try {
    const frame = container.firstElementChild;
    assert.equal(frame.getAttribute("data-ai-chat-ready"), "false");
    container.querySelector('[aria-label="Open AI chat"]').click();
    assert.equal(opened, 0);
    await React.act(async () => { root = hydrateRoot(container, element); });
    assert.equal(container.firstElementChild, frame);
    assert.equal(frame.getAttribute("data-ai-chat-ready"), "true");
    React.act(() => container.querySelector('[aria-label="Open AI chat"]').click());
    assert.equal(opened, 1);
  } finally {
    if (root) React.act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});
