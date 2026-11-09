const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const noop = () => null;
const cn = (...parts) => parts.flat().filter(Boolean).join(" ");

function load(relative, dependencies) {
  const js = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports.default;
}

const mobileContext = { MobileViewContext: React.createContext(false) };
const BaseTitleContainer = load("src/components/PageComponents/TaskDetail/TopRow/BaseTitleContainer.tsx", {
  react: React,
  "@/utils/undoActions/helperFuncs": { cn },
  "@/lib/contexts/mobileContext": mobileContext,
});
const AIChatClosedLayout = load("src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx", {
  react: React,
  "next/navigation": { usePathname: () => "/detail/project-15/8955" },
  "lucide-react": { ChevronLeft: noop },
  "@/components/Common/Tooltip": { __esModule: true, default: noop },
  "@/lib/contexts/mobileContext": mobileContext,
  "@/utils/undoActions/helperFuncs": { cn },
  "@/hooks/useFlag": { useFlag: () => false, useFlagReady: () => true },
  "@/lib/flags/definitions/htpr-8038-chat-opener-ready": { HTPR_8038_CHAT_OPENER_READY_FLAG: "htpr-8038-chat-opener-ready" },
  "@/lib/flags/definitions/htpr-7622-ai-settings": { HTPR_7622_AI_SETTINGS_FLAG: "htpr-7622-ai-settings" },
});

const layers = Object.fromEntries(
  [...read("src/styles/globals.scss").matchAll(/--z-([a-z]+):\s*(\d+);/g)].map(([, name, value]) => [name, Number(value)]),
);

function layerOf(token) {
  const match = /^(?:var\(--z-([a-z]+)\)|z-([a-z]+))$/.exec(token);
  assert.ok(match, `${token} must be a named z layer, not a hand-typed number`);
  const name = match[1] ?? match[2];
  assert.ok(name in layers, `${name} is a layer in globals.scss`);
  return layers[name];
}

function render() {
  const title = React.createElement(BaseTitleContainer, { dataAttribute: "task-detail", titleRowContent: "Ticket title" });
  const page = React.createElement(AIChatClosedLayout, { onOpenAIChat: noop, sidebarWidthPx: 575, panels: React.createElement("aside", null, "Chat") }, title);
  return new JSDOM(renderToString(page)).window.document;
}

test("the ticket title row never sits on a higher layer than the AI chat slot", () => {
  const document = render();
  const title = document.querySelector("[data-title-container=\"task-detail\"]");
  const slot = document.querySelector("[data-ai-chat-slot]");
  assert.ok(title && slot, "ticket title and chat slot rendered");
  const titleLayer = layerOf(title.style.zIndex);
  const slotToken = slot.className.split(/\s+/).map((name) => name.replace(/^max-md:/, "")).find((name) => /^z-/.test(name));
  assert.ok(slotToken, "chat slot carries a layer class");
  assert.ok(layerOf(slotToken) >= titleLayer, "chat slot layer is at or above the title layer");
});

test("the chat slot follows the workspace in the document so it wins a layer tie", () => {
  const document = render();
  const workspace = document.querySelector("[data-ai-workspace]");
  const slot = document.querySelector("[data-ai-chat-slot]");
  assert.ok(workspace.compareDocumentPosition(slot) & document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING, "slot comes after the workspace");
});

test("an explicit title layer still overrides the default", () => {
  const html = renderToString(React.createElement(BaseTitleContainer, { dataAttribute: "task-detail", titleRowContent: "Ticket title", zIndex: 2000 }));
  assert.match(html, /z-index:2000/);
});
