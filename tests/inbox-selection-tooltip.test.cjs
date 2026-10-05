const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");

test("inbox select-all hints sit beyond the desktop checkbox gutter", () => {
  const jiti = createJiti(__filename, { interopDefault: true });
  const { inboxConfig } = jiti(path.join(root, "src/lib/configs/inbox.config.ts"));
  const styles = fs.readFileSync(path.join(root, "src/styles/globals.scss"), "utf8");
  const desktopOffset = Number(styles.match(/@media \(min-width: 768px\)[\s\S]*?--inbox-text-left-offset: (\d+)px/)[1]);
  const gutterInset = Number(styles.match(/\.inbox-row-gutter\s*\{\s*width: calc\(var\(--inbox-text-left-offset\) - (\d+)px\)/)[1]);
  for (const name of ["selectAll", "selectAllGlobal"]) {
    assert.ok(inboxConfig.tooltipOffsets[name].left >= desktopOffset - gutterInset, `${name} must start outside the checkbox gutter`);
  }
});

test("string-only hover hints ignore mouse input in legacy inline, legacy portal and top-layer modes", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const keys = ["window", "document", "React", "IS_REACT_ACT_ENVIRONMENT"];
  const globals = keys.map((key) => Object.getOwnPropertyDescriptor(global, key));
  const cached = new Map(Object.entries(require.cache));
  let enabled = false;
  let reactRoot;
  try {
    Object.assign(global, { window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true });
    window.HTMLElement.prototype.showPopover = function () {};
    const stub = (file, exports) => {
      const filename = path.join(root, file);
      require.cache[filename] = { id: filename, filename, loaded: true, exports };
    };
    stub("src/hooks/useFlag.tsx", { useFlag: () => enabled });
    stub("src/utils/undoActions/helperFuncs.ts", { cn: (...classes) => classes.filter(Boolean).join(" ") });
    const jiti = createJiti(__filename, { interopDefault: true, fsCache: false, jsx: true, alias: { "@": path.join(root, "src") } });
    const Tooltip = jiti(path.join(root, "src/components/Common/Tooltip.tsx")).default;
    const TooltipPortal = jiti(path.join(root, "src/components/Common/TooltipPortal.tsx")).default;
    const css = require("sass").compile(path.join(root, "src/styles/_tooltip-portal.scss")).css;
    const sheet = document.createElement("style");
    sheet.textContent = `${css}\n.pointer-events-none { pointer-events: none; }`;
    document.head.append(sheet);
    const container = document.getElementById("root");
    reactRoot = require("react-dom/client").createRoot(container);
    for (enabled of [false, true]) {
      for (const portal of [false, true]) {
        await React.act(async () => reactRoot.render(React.createElement("div", { className: "group" }, React.createElement(Tooltip, {
          text: "Select all", keyCombination: ["CTRL", "SHIFT", "A"], bottom: 0, left: 48, portal,
        }))));
        await React.act(async () => container.firstElementChild.dispatchEvent(new window.MouseEvent("mouseenter")));
        const surface = document.querySelector(enabled ? "[data-hover-tooltip-portal]" : ".z-\\[9999\\]");
        assert.ok(surface, `enabled=${enabled}, portal=${portal}: hint opens`);
        assert.equal(window.getComputedStyle(surface).pointerEvents, "none", `enabled=${enabled}, portal=${portal}: hint cannot intercept the checkbox click`);
        assert.equal(surface.textContent, "Select allCTRLSHIFTA");
        await React.act(async () => container.firstElementChild.dispatchEvent(new window.MouseEvent("mouseleave")));
        if (enabled || portal) assert.equal(surface.isConnected, false, "leaving the trigger closes the hint");
        await React.act(async () => reactRoot.render(null));
      }
    }
    let clicks = 0;
    await React.act(async () => reactRoot.render(React.createElement(TooltipPortal, { interactive: true }, React.createElement("button", { onClick: () => clicks++ }, "Copy email"))));
    const button = document.querySelector("[data-interactive] button");
    assert.equal(window.getComputedStyle(button).pointerEvents, "auto", "interactive hovercards keep mouse input");
    await React.act(async () => button.click());
    assert.equal(clicks, 1);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
    keys.forEach((key, i) => globals[i] ? Object.defineProperty(global, key, globals[i]) : delete global[key]);
    dom.window.close();
  }
});
