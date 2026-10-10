const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7020-tag-full-name";
const name = "ui-label-1791505618369-long-tag-name-that-exceeds-the-details-chip-width";

function load(relative, dependencies) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((key) => {
    if (key === "react" || key === "react-dom" || key === "react/jsx-runtime") return require(key);
    assert.ok(key in dependencies, `Unexpected dependency: ${key}`);
    return dependencies[key];
  }, exports);
  return exports.default;
}

for (const topLayer of [false, true]) {
  test(`full task tag name respects its flag with tooltip top layer ${topLayer}`, async (t) => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    const saved = new Map();
    let reactRoot;
    let enabled = false;
    try {
      for (const [key, value] of Object.entries({
        window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
        Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
      })) {
        saved.set(key, Object.getOwnPropertyDescriptor(global, key));
        Object.defineProperty(global, key, { configurable: true, writable: true, value });
      }
      const keys = {
        HTPR_7020_TAG_FULL_NAME_FLAG: flag,
        HTPR_6950_TOOLTIP_TOP_LAYER_FLAG: "htpr-6950-tooltip-top-layer",
      };
      const dependencies = {
        "@/hooks/useFlag": { useFlag: (key) => key === flag ? enabled : key === keys.HTPR_6950_TOOLTIP_TOP_LAYER_FLAG && topLayer },
        "@/lib/flags/keys": keys,
      };
      const Portal = load("src/components/Common/TooltipPortal.tsx", {});
      const Tooltip = load("src/components/Common/Tooltip.tsx", {
        ...dependencies, "./TooltipPortal": { __esModule: true, default: Portal },
        "./kbd": { __esModule: true, default: () => null },
      });
      const Wrapper = load("src/components/Labels/LabelWrapper.tsx", {
        "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
      });
      const Label = load("src/components/Modals/CreateLabel/TaskLabelComponent.tsx", {
        ...dependencies, "@/components/Labels/LabelWrapper": { __esModule: true, default: Wrapper },
        "@/components/Common/Tooltip": { __esModule: true, default: Tooltip },
      });
      const container = document.getElementById("root");
      reactRoot = require("react-dom/client").createRoot(container);
      const render = async (props = {}) => React.act(async () => reactRoot.render(
        React.createElement(Label, { key: String(enabled), labelValue: name, taskDetail: true, fontSize: 13, ...props }),
      ));
      await render();
      const legacy = container.innerHTML;
      await t.test("flag off retains the existing chip without a tooltip", () => {
        assert.equal(container.firstElementChild.title, "");
        assert.equal(document.querySelector("[data-hover-tooltip-portal]"), null);
        assert.equal(container.querySelector("span").textContent, name);
      });
      enabled = true;
      await render();
      await t.test("flag on makes the complete name readable on hover without changing the chip", async () => {
        const chip = container.firstElementChild;
        assert.equal(chip.title, "", "no native title so only one tooltip shows");
        assert.equal(chip.style.fontSize, "12px");
        assert.equal(container.querySelector("span").style.fontSize, "13px");
        assert.ok(container.querySelector("span").classList.contains("text-ellipsis"));
        await React.act(async () => chip.dispatchEvent(new window.MouseEvent("mouseenter")));
        const tooltip = topLayer
          ? document.querySelector("[data-hover-tooltip-portal]")
          : [...document.body.children].find((el) => el !== container && el.textContent === name);
        assert.ok(tooltip, "the existing Tooltip must open for the chip");
        assert.equal(tooltip.textContent, name);
        assert.ok(tooltip.querySelector(".break-words"), "the full name can wrap instead of being clipped");
        await React.act(async () => chip.dispatchEvent(new window.MouseEvent("mouseleave")));
        assert.equal(document.querySelector("[data-hover-tooltip-portal]"), null);
      });
      await t.test("an updated tag name updates the tooltip", async () => {
        await render({ labelValue: "renamed-" + name });
        const chip = container.firstElementChild;
        assert.equal(chip.title, "");
        await React.act(async () => chip.dispatchEvent(new window.MouseEvent("mouseenter")));
        assert.ok(document.body.textContent.includes("renamed-" + name));
        await React.act(async () => chip.dispatchEvent(new window.MouseEvent("mouseleave")));
      });
      await t.test("non-detail chips and flag-off rollback preserve legacy output and click handling", async () => {
        let clicks = 0;
        await render({ taskDetail: false, stopPropogation: true, onClick: () => clicks++ });
        assert.equal(container.firstElementChild.title, "");
        assert.equal(container.querySelectorAll("span").length, 1);
        const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
        await React.act(async () => container.firstElementChild.dispatchEvent(event));
        assert.equal(clicks, 1);
        assert.equal(event.defaultPrevented, true);
        enabled = false;
        await render();
        assert.equal(container.innerHTML, legacy);
      });
    } finally {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
      }
      dom.window.close();
    }
  });
}
