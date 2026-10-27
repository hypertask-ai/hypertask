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
let compactMobileUndo = false;
const undo = load("src/components/undoToast/index.tsx", {
  "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
  "@/lib/configs/general.config": { MOBILE_TARGET: mobileTarget },
  "@/hooks/useFlag": { useFlag: (key) => key === "htpr-8097-mobile-undo-toast" && compactMobileUndo },
  "@/lib/flags/definitions/htpr-8097-mobile-undo-toast": { HTPR_8097_MOBILE_UNDO_TOAST_FLAG: "htpr-8097-mobile-undo-toast" },
  "@/lib/flags/keys": { HTPR_7657_ONE_TOAST_FLAG: "htpr-7657-one-toast" },
  "@/lib/toastIdsToDismiss": { toastIdsToDismiss: () => [] },
  "@/lib/constants/appShellRail": { APP_SHELL_RAIL_OFFSET: "calc(var(--app-shell-rail-w, 48px) + 8px)" },
});
const { useMobileToastAutoDismiss } = load("src/components/undoToast/useMobileToastAutoDismiss.ts");
// Exercise the production Toaster JSX, including isolation and rail/phone offsets.
const globalSource = read("src/components/ProviderGlobal/GloablProviders.tsx");
const toasterMarkup = globalSource.slice(globalSource.indexOf("      <Toaster"), globalSource.indexOf("      <ShortcutArchiveNudge"));
const { Toasts } = load("src/components/ProviderGlobal/GloablProviders.tsx", {
  "react-hot-toast": hotToast,
  "@/components/undoToast": undo,
}, `import { Toaster } from "react-hot-toast";
import { SingleUndoToaster } from "@/components/undoToast";
export function Toasts({mbl, appShellRailOn}) { return <>${toasterMarkup}</>; }`);

async function fixture(t, { mobile = false, rail = true } = {}) {
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
  let namedStore;
  let defaultStore;
  function App() {
    namedStore = hotToast.useToasterStore({}, undo.SINGLE_UNDO_TOASTER_ID);
    defaultStore = hotToast.useToasterStore();
    useMobileToastAutoDismiss();
    useMobileToastAutoDismiss(undo.SINGLE_UNDO_TOASTER_ID);
    return React.createElement(mobileContext.Provider, { value: mobile },
      React.createElement(Toasts, { mbl: mobile, appShellRailOn: rail && !mobile }));
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
    card() { return document.querySelector(`[data-rht-toaster="${undo.SINGLE_UNDO_TOASTER_ID}"] > div > div`); },
    namedToasts() { return namedStore.toasts; },
    defaultToasts() { return defaultStore.toasts; },
  };
}

for (const mobile of [false, true]) {
  test(`single toast replaces only the undo card with unique action IDs (${mobile ? "phone" : "desktop"})`, async (t) => {
    const f = await fixture(t, { mobile });
    await React.act(async () => hotToast.toast.success("Other notification", { duration: Infinity }));
    const first = await f.show("First action");
    assert.deepEqual(f.namedToasts().map((toast) => toast.id), [first]);
    // A matching ID in another store must survive scoped removal/dismissal.
    await React.act(async () => hotToast.toast.success("Default toaster twin", { id: first, toasterId: "default", duration: Infinity }));
    const undone = [];
    const second = await f.show("Marked as Done.", { id: 2 }, async (data, id) => undone.push([data, id]));
    assert.notEqual(first, second);
    assert.deepEqual(f.namedToasts().map((toast) => toast.id), [second]);
    assert.equal(f.defaultToasts().find((toast) => toast.id === first).visible, true);
    assert.equal(document.body.textContent.includes("First action"), false);
    assert.equal(document.querySelectorAll('[aria-label="Undo"]').length, 1);
    assert.ok(document.body.textContent.includes("Other notification"));
    const card = f.card();
    assert.equal(card.style.opacity, "1");
    assert.equal(card.style.transition, "opacity 200ms ease-in-out");
    for (const token of ["bg-modalBackground", "text-white-black", "font-normal", "border-l-[3px]", "border-hypertasks-header-blue", "rounded-[5px]", "min-h-10", "gap-2"]) assert.ok(card.classList.contains(token));
    const undoButton = card.querySelector('[aria-label="Undo"]');
    assert.equal(undoButton.textContent, "Undo");
    assert.ok(undoButton.classList.contains("font-normal"));
    assert.ok(undoButton.classList.contains("text-text-light-gray"));
    assert.ok(undoButton.classList.contains("hover:text-white-black"));
    assert.equal(card.querySelector("svg").getAttribute("width"), "14");
    if (mobile) for (const button of card.querySelectorAll("button")) assert.ok(button.classList.contains("min-h-[44px]"));
    const container = card.parentElement.parentElement;
    assert.equal(container.style.left, mobile ? "16px" : "calc(var(--app-shell-rail-w, 48px) + 8px)");
    assert.equal(card.parentElement.style.bottom, "0px");
    if (mobile) assert.equal(container.style.bottom, "calc(72px + env(safe-area-inset-bottom))");
    await f.event(undoButton, "click");
    assert.deepEqual(undone, [[{ id: 2 }, second]]);
    await React.act(async () => hotToast.toast.success("Second default twin", { id: second, toasterId: "default", duration: Infinity }));
    await f.event(card.querySelector('[aria-label="Dismiss"]'), "click");
    assert.equal(f.namedToasts().find((toast) => toast.id === second).visible, false);
    assert.equal(f.defaultToasts().find((toast) => toast.id === second).visible, true);
    assert.equal(f.card().style.opacity, "0");
    await f.tick(200);
    assert.deepEqual(f.namedToasts(), []);
    assert.equal(f.defaultToasts().find((toast) => toast.id === second).visible, true);
    assert.equal(f.card(), null);
  });

  test(`Undo handler's unscoped dismissal reaches the real named store (${mobile ? "phone" : "desktop"})`, async (t) => {
    const f = await fixture(t, { mobile });
    const undone = [];
    const id = await f.show("Undo action", { id: 3 }, async (data, toastId) => {
      undone.push([data, toastId]);
      // Existing undo handlers call dismiss with just the action ID.
      hotToast.toast.dismiss(toastId);
    });
    await f.event(f.card().querySelector('[aria-label="Undo"]'), "click");
    assert.deepEqual(undone, [[{ id: 3 }, id]]);
    assert.equal(f.namedToasts().find((toast) => toast.id === id).visible, false);
    assert.equal(f.card().style.opacity, "0");
    await f.tick(200);
    assert.deepEqual(f.namedToasts(), []);
    assert.equal(f.card(), null);
  });

  test(`single toast expires after 5000ms then removes after 200ms (${mobile ? "phone" : "desktop"})`, async (t) => {
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


test("the global provider always mounts the named undo toaster and mobile auto-dismiss hook", () => {
  assert.match(globalSource, /useMobileToastAutoDismiss\(SINGLE_UNDO_TOASTER_ID\)/);
  assert.match(toasterMarkup, /<SingleUndoToaster mobile=\{mbl\} appShellRailOn=\{appShellRailOn\} \/>/);
});

for (const mobile of [true, false]) {
  test(`compact mobile undo flag preserves actions and desktop placement (${mobile ? "phone" : "desktop"})`, async (t) => {
    compactMobileUndo = true;
    t.after(() => { compactMobileUndo = false; });
    const f = await fixture(t, { mobile });
    await React.act(async () => hotToast.toast.success("Ordinary notification", { duration: Infinity }));
    const defaultContainer = document.querySelector('[data-rht-toaster="default"]');
    const ordinaryStyle = defaultContainer.getAttribute("style");
    const undone = [];
    const id = await f.show("Undo remove notification", { id: 7 }, async (data, toastId) => undone.push([data, toastId]));
    const card = f.card();
    const container = card.parentElement.parentElement;
    assert.equal(container.style.top, mobile ? "52%" : "16px");
    assert.equal(container.style.bottom, "16px");
    assert.equal(card.parentElement.style[mobile ? "top" : "bottom"], "0px");
    assert.equal(card.classList.contains("max-w-[110px]"), mobile);
    assert.equal(card.classList.contains("flex-col"), mobile);
    assert.equal(defaultContainer.getAttribute("style"), ordinaryStyle);
    assert.ok(defaultContainer.textContent.includes("Ordinary notification"));
    assert.equal(container.style.left, mobile ? "16px" : "calc(var(--app-shell-rail-w, 48px) + 8px)");
    for (const button of card.querySelectorAll("button")) {
      if (mobile) assert.ok(button.classList.contains("min-h-[44px]"));
    }
    await f.event(card.querySelector('[aria-label="Undo"]'), "click");
    assert.deepEqual(undone, [[{ id: 7 }, id]]);
    await f.event(card.querySelector('[aria-label="Dismiss"]'), "click");
    assert.equal(f.namedToasts().find((toast) => toast.id === id).visible, false);
    await f.tick(200);
    assert.equal(f.card(), null);
  });
}
