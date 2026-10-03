const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const hotToast = require("react-hot-toast");

const rootDir = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(rootDir, file), "utf8");
const mobileContext = React.createContext(false);
const mobileTarget = read("src/lib/configs/general.config.ts").match(/export const MOBILE_TARGET =\s*"([^"]+)"/)[1];
function load(relativePath, stubs = {}, source = read(relativePath)) {
  const filename = path.join(rootDir, relativePath);
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (key) => stubs[key] ?? createRequire(filename)(key), loaded, loaded.exports,
  );
  return loaded.exports;
}
const undo = load("src/components/undoToast/index.tsx", {
  "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
  "@/lib/configs/general.config": { MOBILE_TARGET: mobileTarget },
});
const { useMobileToastAutoDismiss } = load("src/components/undoToast/useMobileToastAutoDismiss.ts");
// Exercise the production Toaster JSX, including isolation and rail/phone offsets.
const globalSource = read("src/components/ProviderGlobal/GloablProviders.tsx");
const toasterMarkup = globalSource.slice(globalSource.indexOf("      <Toaster"), globalSource.indexOf("      <ShortcutArchiveNudge"));
const flagEffect = globalSource.slice(globalSource.indexOf("  useEffect(() => {\n    undoToastSettings.single"), globalSource.indexOf("  const isApple", globalSource.indexOf("  useEffect(() => {\n    undoToastSettings.single")));
const { Toasts } = load("src/components/ProviderGlobal/GloablProviders.tsx", {
  "react-hot-toast": hotToast,
  "@/components/undoToast": undo,
  "@/lib/constants/appShellRail": { APP_SHELL_RAIL_OFFSET: "calc(var(--app-shell-rail-w, 48px) + 8px)" },
}, `import { useEffect } from "react";
import { Toaster } from "react-hot-toast";
import { SINGLE_UNDO_TOASTER_ID, undoToastSettings } from "@/components/undoToast";
import { APP_SHELL_RAIL_OFFSET } from "@/lib/constants/appShellRail";
export function Toasts({mbl, singleUndoToast, appShellRailOn}) { ${flagEffect} return <>${toasterMarkup}</>; }`);

async function fixture(t, { mobile = false, enabled = true, rail = true } = {}) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://example.test" });
  const previous = {};
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver,
    matchMedia: () => ({ matches: false }), IS_REACT_ACT_ENVIRONMENT: true,
  })) { previous[key] = global[key]; global[key] = value; }
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  hotToast.toast.removeAll();
  hotToast.toast.removeAll(undo.SINGLE_UNDO_TOASTER_ID);
  const root = createRoot(document.getElementById("root"));
  function App() {
    useMobileToastAutoDismiss();
    useMobileToastAutoDismiss(undo.SINGLE_UNDO_TOASTER_ID);
    return React.createElement(mobileContext.Provider, { value: mobile },
      React.createElement(Toasts, { mbl: mobile, singleUndoToast: enabled, appShellRailOn: rail && !mobile }));
  }
  await React.act(async () => root.render(React.createElement(App)));
  t.after(async () => {
    await React.act(async () => {
      hotToast.toast.removeAll(); hotToast.toast.removeAll(undo.SINGLE_UNDO_TOASTER_ID); root.unmount();
    });
    t.mock.timers.reset();
    dom.window.close();
    Object.assign(global, previous);
  });
  return {
    async show(message, data = message, handler = async () => {}) {
      let id;
      await React.act(async () => { id = undo.UndoToaster(message, data, handler, mobile); });
      return id;
    },
    async tick(ms) { await React.act(async () => t.mock.timers.tick(ms)); },
    async event(target, type) { await React.act(async () => target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true }))); },
    async setEnabled(value) { enabled = value; await React.act(async () => root.render(React.createElement(App))); },
    card() { return document.querySelector(`[data-rht-toaster="${undo.SINGLE_UNDO_TOASTER_ID}"] > div > div`); },
  };
}

for (const mobile of [false, true]) {
  test(`flag on replaces only the undo card with unique action IDs (${mobile ? "phone" : "desktop"})`, async (t) => {
    const f = await fixture(t, { mobile });
    await React.act(async () => hotToast.toast.success("Other notification", { duration: Infinity }));
    const first = await f.show("First action");
    const undone = [];
    const second = await f.show("Marked as Done.", { id: 2 }, async (data, id) => undone.push([data, id]));
    assert.notEqual(first, second);
    assert.equal(document.body.textContent.includes("First action"), false);
    assert.equal(document.querySelectorAll('[aria-label="Undo"]').length, 1);
    assert.ok(document.body.textContent.includes("Other notification"));
    const card = f.card();
    assert.equal(card.style.opacity, "1");
    assert.equal(card.style.transition, "opacity 200ms ease-in-out");
    for (const token of ["bg-modalBackground", "text-white-black", "font-normal", "border-l-[3px]", "border-hypertasks-header-blue", "rounded-[5px]", "min-h-10"]) assert.ok(card.classList.contains(token));
    const undoButton = card.querySelector('[aria-label="Undo"]');
    assert.equal(undoButton.textContent, "Undo");
    assert.ok(undoButton.classList.contains("font-normal"));
    assert.ok(undoButton.classList.contains("text-hypertasks-header-blue"));
    assert.equal(card.querySelector("svg").getAttribute("width"), "14");
    if (mobile) for (const button of card.querySelectorAll("button")) assert.ok(button.classList.contains("min-h-[44px]"));
    const container = card.parentElement.parentElement;
    assert.equal(container.style.left, mobile ? "16px" : "calc(var(--app-shell-rail-w, 48px) + 8px)");
    assert.equal(card.parentElement.style.bottom, "0px");
    if (mobile) assert.equal(container.style.bottom, "calc(72px + env(safe-area-inset-bottom))");
    await f.event(undoButton, "click");
    assert.deepEqual(undone, [[{ id: 2 }, second]]);
    await f.event(card.querySelector('[aria-label="Dismiss"]'), "click");
    assert.equal(f.card().style.opacity, "0");
    await f.tick(200);
    assert.equal(f.card(), null);
  });

  test(`flag on expires after 5000ms then removes after 200ms (${mobile ? "phone" : "desktop"})`, async (t) => {
    const f = await fixture(t, { mobile });
    await f.show("Timed action");
    await f.tick(4999);
    assert.equal(f.card().style.opacity, "1");
    await f.tick(1);
    assert.equal(f.card().style.opacity, "0");
    await f.tick(199);
    assert.ok(f.card());
    await f.tick(1);
    assert.equal(f.card(), null);
  });
}

test("hover pauses only undo duration and mouseleave resumes it", async (t) => {
  const f = await fixture(t);
  await f.show("Hovered action");
  await React.act(async () => hotToast.toast.success("Unrelated timed notification"));
  await f.tick(1000);
  await f.event(f.card(), "mouseover");
  await f.tick(6000);
  assert.equal(f.card().style.opacity, "1");
  await f.tick(1000);
  assert.equal(document.body.textContent.includes("Unrelated timed notification"), false);
  await f.event(f.card(), "mouseout");
  await f.tick(3999);
  assert.equal(f.card().style.opacity, "1");
  await f.tick(1);
  assert.equal(f.card().style.opacity, "0");
});

for (const type of ["touchend", "touchcancel"]) {
  test(`phone ${type} resumes a synthetic-hover pause without inflating idle timers`, async (t) => {
    const f = await fixture(t, { mobile: true });
    await f.show("Phone action");
    await f.event(document, type);
    await f.tick(1000);
    await f.event(f.card(), "mouseover");
    await f.tick(1000);
    await f.event(document, type);
    await f.tick(4000);
    assert.equal(f.card().style.opacity, "0");
  });
}

for (const mobile of [false, true]) {
  test(`flag off preserves stacking, design, duration and position (${mobile ? "phone" : "desktop"})`, async (t) => {
    const f = await fixture(t, { enabled: false, mobile });
    await f.show("First legacy action");
    await f.show("Second legacy action");
    assert.equal(document.querySelectorAll('[aria-label="Undo"]').length, 2);
    assert.equal(document.querySelector(`[data-rht-toaster="${undo.SINGLE_UNDO_TOASTER_ID}"]`), null);
    const button = document.querySelector('[aria-label="Undo"]');
    const card = button.closest("[style]");
    assert.equal(button.textContent, mobile ? "Undo" : "UNDO");
    assert.ok(card.classList.contains(mobile ? "bg-modalBackground" : "bg-white"));
    assert.equal(card.parentElement.style[mobile ? "top" : "bottom"], "0px");
    assert.equal(card.style.transition, mobile ? "opacity 150ms ease-in-out, transform 200ms ease-in-out" : "opacity 150ms ease-in-out");
    await f.tick((mobile ? 7500 : 15000) - 1);
    assert.equal(card.style.opacity, "1");
    await f.tick(1);
    assert.equal(card.style.opacity, "0");
  });
}

test("flag is registered with Owner + QA default and the global toaster publishes it to imperative callers", async (t) => {
  assert.equal(undo.undoToastSettings.single, false);
  assert.match(read("src/lib/flags/keys.ts"), /HTPR_6885_SINGLE_UNDO_TOAST_FLAG = "htpr-6885-single-undo-toast"/);
  assert.match(read("src/lib/flags.ts"), /key: HTPR_6885_SINGLE_UNDO_TOAST_FLAG/);
  assert.match(read("src/lib/flags.ts"), /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
  assert.match(globalSource, /useFlag\(HTPR_6885_SINGLE_UNDO_TOAST_FLAG\)/);
  const f = await fixture(t, { enabled: false });
  assert.equal(undo.undoToastSettings.single, false);
  await f.setEnabled(true);
  assert.equal(undo.undoToastSettings.single, true);
  await f.show("Enabled action");
  assert.ok(f.card());
  await f.setEnabled(false);
  assert.equal(undo.undoToastSettings.single, false);
  await f.show("Disabled action");
  assert.equal(f.card(), null);
  assert.equal(document.querySelector('[aria-label="Undo"]').textContent, "UNDO");
});
