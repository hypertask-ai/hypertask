const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function layerValues(source) {
  return [...source.matchAll(/\bz-\[(\d+)\]|\bz-(\d+)\b|(?:zIndex|z-index|[A-Z_]*Z_INDEX)\s*[:=]\s*["'{]?(\d+(?:e[+]?\d+)?)/g)]
    .map((match) => Number(match[1] ?? match[2] ?? match[3]));
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:tsx?|jsx?|s?css)$/.test(file) ? [file] : [];
  });
}

test("the shared hover-tooltip layer clears every numeric app layer", () => {
  const styles = read("src/styles/_tooltip-portal.scss");
  const definitions = [...styles.matchAll(/--z-hover-tooltip:\s*(\d+)/g)];
  assert.equal(definitions.length, 1);
  const tooltipLayer = Number(definitions[0][1]);
  const files = [...sourceFiles(path.join(root, "src")), path.join(root, "tailwind.config.ts")];
  for (const file of files) {
    for (const layer of layerValues(fs.readFileSync(file, "utf8"))) {
      assert.ok(tooltipLayer > layer, `${path.relative(root, file)} uses ${layer}, above the tooltip layer ${tooltipLayer}`);
    }
  }
  assert.match(styles, /z-index:\s*var\(--z-hover-tooltip\)/);
  assert.deepEqual(layerValues('z-[999999999] z-50 zIndex: "100000"; z-index: 12000; APP_SHEET_Z_INDEX = 9990; zIndex: 1e9'), [999999999, 50, 100000, 12000, 9990, 1000000000]);
  assert.ok(![1000000001].every((layer) => tooltipLayer > layer), "the layer oracle rejects an excessive overlay");
});

test("all custom hover implementations gate the shared top-layer portal", () => {
  const implementations = [
    "src/components/Common/Tooltip.tsx",
    "src/components/Common/ReactTooltip.tsx",
    "src/components/Common/TimeTooltip.tsx",
    "src/components/Common/PersonHovercard.tsx",
    "src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx",
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentEmojiTooltip.tsx",
    "src/components/notifications/comment.tsx",
    "src/components/notifications/assigned.tsx",
  ];
  for (const file of implementations) {
    const source = read(file);
    assert.match(source, /<TooltipPortal(?:\s|>)/, file);
    assert.match(source, /useFlag\(HTPR_6950_TOOLTIP_TOP_LAYER_FLAG\)/, file);
  }
  const portal = read("src/components/Common/TooltipPortal.tsx");
  assert.match(portal, /createPortal\(/);
  assert.match(portal, /popover="manual"/);
  assert.match(portal, /showPopover/);
  assert.match(portal, /closest\("dialog\[open\]"\)/);
});

let fixtureTopLayer = true;

async function withTooltipFixture(check) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai" });
  const globalKeys = ["window", "document", "React", "IS_REACT_ACT_ENVIRONMENT"];
  const previousGlobals = globalKeys.map((key) => Object.getOwnPropertyDescriptor(global, key));
  const stubs = {
    "src/hooks/useFlag.tsx": { useFlag: () => fixtureTopLayer },
    "src/utils/generateTime.ts": { default: () => "Just now" },
    "src/utils/helperFunctions/helperFunctions.ts": { convertToPlain: (text) => text, formatDateToGMT: () => "5 October 2026, 12:00 GMT" },
    "src/utils/undoActions/helperFuncs.ts": { cn: (...classes) => classes.filter(Boolean).join(" ") },
  };
  const previousModules = Object.keys(stubs).map((file) => require.cache[path.join(root, file)]);
  fixtureTopLayer = true;
  let reactRoot;
  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.React = React;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    dom.window.HTMLElement.prototype.showPopover = function () { this.dataset.topLayer = "shown"; };
    dom.window.HTMLElement.prototype.hidePopover = function () { delete this.dataset.topLayer; };
    const matches = dom.window.Element.prototype.matches;
    dom.window.Element.prototype.matches = function (selector) {
      return selector === ":popover-open" ? this.dataset.topLayer === "shown" : matches.call(this, selector);
    };
    const observers = [];
    dom.window.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.elements = new Set(); observers.push(this); }
      observe(element) { this.elements.add(element); }
      disconnect() { this.elements.clear(); }
    };
    Object.entries(stubs).forEach(([file, exports]) => {
      const filename = path.join(root, file);
      require.cache[filename] = { id: filename, filename, loaded: true, exports };
    });
    const jiti = createJiti(__filename, { interopDefault: true, jsx: true, alias: { "@": path.join(root, "src") } });
    const container = document.getElementById("root");
    reactRoot = require("react-dom/client").createRoot(container);
    await check({
      load: (file) => jiti(path.join(root, file)).default,
      container,
      observers,
      setFlag: (enabled) => { fixtureTopLayer = enabled; },
      render: async (element) => React.act(async () => reactRoot.render(element)),
    });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    fixtureTopLayer = true;
    dom.window.close();
    globalKeys.forEach((key, index) => {
      if (previousGlobals[index]) Object.defineProperty(global, key, previousGlobals[index]);
      else delete global[key];
    });
    Object.keys(stubs).forEach((file, index) => {
      const filename = path.join(root, file);
      if (previousModules[index]) require.cache[filename] = previousModules[index];
      else delete require.cache[filename];
    });
  }
}

const reactionFile = "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentEmojiTooltip.tsx";

test("label tooltips size to their text in both legacy and top-layer placements", async () => {
  await withTooltipFixture(async ({ load, container, render, setFlag }) => {
    const Tooltip = load("src/components/Common/Tooltip.tsx");
    const anchor = document.createElement("button");
    document.body.append(anchor);
    for (const enabled of [true, false]) {
      setFlag(enabled);
      for (const portal of [false, true]) {
        for (const text of ["Copy task ID", "A long related-ticket title that must remain a single line", "Superhuman Command"]) {
          await render(React.createElement("div", { className: "relative group" }, React.createElement(Tooltip, {
            text, keyCombination: ["ctrl", "K"], left: 0, bottom: -40, portal,
            anchorElement: portal ? anchor : null,
          })));
          await React.act(async () => container.firstElementChild.dispatchEvent(new window.MouseEvent("mouseenter")));
          const surface = enabled
            ? document.querySelector("[data-hover-tooltip-portal]").firstElementChild
            : portal ? document.body.querySelector(".fixed") : container.firstElementChild.firstElementChild;
          // One line sized to the text; wrapping only past the viewport cap.
          const singleLine = surface.classList.contains("whitespace-nowrap")
            || (surface.classList.contains("w-max") && surface.classList.contains("max-w-[calc(100vw-16px)]"));
          assert.ok(singleLine, `flag=${enabled}, portal=${portal}: ${text}`);
          assert.equal(surface.firstElementChild.textContent.trim(), text);
          await render(null);
        }
      }
    }
  });
});

test("rich and tutorial tooltips retain legacy widths and wrapping, while shortcut labels remain nowrap", async () => {
  await withTooltipFixture(async ({ load, container, render, setFlag }) => {
    const layout = (surface) => [surface, ...surface.querySelectorAll("*")].map((element) =>
      [...element.classList].filter((name) => /(?:^|:)(?:whitespace-|text-wrap|break-|(?:min-|max-)?w-)/.test(name)).sort());
    const cases = [
      ["src/components/Common/ReactTooltip.tsx", { className: "scale-100", children: "A wrapping reaction hovercard" }, "sm:w-[200px]"],
      ["src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx", { top: 15, left: 0, text: "A wrapping tutorial tip", className: "w-[240px]" }, "w-[240px]"],
      ["src/components/Common/TimeTooltip.tsx", { time: new Date(), bottom: -5, left: 55 }, "whitespace-nowrap"],
    ];
    for (const [file, props, required] of cases) {
      const Component = load(file);
      let legacyLayout;
      for (const enabled of [false, true]) {
        setFlag(enabled);
        await render(React.createElement("div", { className: "relative group" }, React.createElement(Component, props)));
        const surface = enabled ? document.querySelector("[data-hover-tooltip-portal]").firstElementChild : container.firstElementChild.firstElementChild;
        assert.ok(surface.classList.contains(required), file);
        if (enabled) assert.deepEqual(layout(surface), legacyLayout, file);
        else legacyLayout = layout(surface);
        await render(null);
      }
    }
    setFlag(true);
    const ReactionTooltip = load(reactionFile);
    await render(React.createElement("div", { className: "relative group" }, React.createElement(ReactionTooltip)));
    await React.act(async () => container.firstElementChild.dispatchEvent(new window.MouseEvent("mouseenter")));
    const rows = document.querySelector("[data-hover-tooltip-portal]").firstElementChild.children;
    assert.equal(rows.length, 2);
    for (const row of rows) assert.ok(row.classList.contains("whitespace-nowrap"));
    const person = read("src/components/Common/PersonHovercard.tsx");
    assert.match(person, /className=\{`relative \$\{topLayer[^\n]+ w-\[272px\]/);
    assert.match(person, /\{surface\}[\s\S]+: surface\}/, "both person hovercard paths reuse the fixed-width surface");
  });
});

test("portal children have zero-specificity intrinsic sizing without overriding explicit widths", () => {
  const styles = read("src/styles/_tooltip-portal.scss");
  assert.match(styles, /@layer base\s*\{\s*:where\(\[data-hover-tooltip-portal\]\)\s*>\s*\*\s*\{\s*width:\s*max-content;\s*max-width:\s*calc\(100vw - 16px\);\s*\}\s*\}/);
});

test("intrinsic-width labels stay clamped on narrow viewports and after content resize", async () => {
  await withTooltipFixture(async ({ load, container, render, observers }) => {
    Object.defineProperty(window, "innerWidth", { value: 320, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 240, configurable: true });
    const nativeBounds = window.HTMLElement.prototype.getBoundingClientRect;
    let width = 280;
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.id === "small-trigger") return new window.DOMRect(300, 220, 12, 12);
      if (this.parentElement?.hasAttribute("data-hover-tooltip-portal")) {
        const portal = this.parentElement;
        const left = parseFloat(portal.style.left) + (parseFloat(this.style.left) || 0);
        const top = this.style.bottom ? parseFloat(portal.style.top) + parseFloat(portal.style.height) - parseFloat(this.style.bottom) - 30 : parseFloat(portal.style.top);
        return new window.DOMRect(left, top, width, 30);
      }
      return nativeBounds.call(this);
    };
    const Tooltip = load("src/components/Common/Tooltip.tsx");
    for (const portal of [false, true]) {
      width = 280;
      await render(React.createElement("button", { id: "small-trigger", className: "relative group" }, React.createElement(Tooltip, {
        text: "A long related-ticket title", keyCombination: [], left: 0, bottom: -40, portal,
      })));
      await React.act(async () => container.firstElementChild.dispatchEvent(new window.MouseEvent("mouseenter")));
      const surface = document.querySelector("[data-hover-tooltip-portal]").firstElementChild;
      const checkBounds = () => {
        const bounds = surface.getBoundingClientRect();
        assert.equal(bounds.right, window.innerWidth - 8);
        assert.ok(bounds.left >= 8);
        assert.ok(bounds.top >= 0);
        assert.ok(bounds.bottom <= window.innerHeight);
      };
      checkBounds();
      width = 304;
      const observer = observers.find((entry) => entry.elements.has(surface));
      assert.ok(observer);
      await React.act(async () => observer.callback());
      checkBounds();
      await React.act(async () => window.dispatchEvent(new window.Event("resize")));
      checkBounds();
      await render(null);
    }
  });
});

test("notification tooltip rect aligns beside its trigger, not the offsetParent origin", async () => {
  await withTooltipFixture(async ({ load, container, render, setFlag }) => {
    const nativeBounds = window.HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(window.HTMLElement.prototype, "offsetParent", { configurable: true, get: () => container });
    container.getBoundingClientRect = () => new window.DOMRect(20, 30, 900, 700);
    let triggerRect = new window.DOMRect(400, 250, 15, 20);
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.tagName === "BUTTON") return triggerRect;
      if (this.hasAttribute("data-hover-tooltip-content")) {
        const portal = this.parentElement;
        const left = parseFloat(portal.style.left) + (this.style.left === "100%" ? parseFloat(portal.style.width) : 0);
        return new window.DOMRect(left, parseFloat(portal.style.top), 100, 30);
      }
      return nativeBounds.call(this);
    };
    for (const file of ["src/components/notifications/assigned.tsx", "src/components/notifications/comment.tsx"]) {
      const Component = load(file);
      let done = 0;
      let opened = 0;
      const props = { notification: { id: 1, createdAt: new Date(), status: "Normal" }, markAsDone: () => done++, openTask: () => opened++, setSelectedInbox: () => {}, _selectedInbox: null };
      setFlag(true);
      await render(React.createElement(Component, props));
      const group = container.querySelector(".group");
      await React.act(async () => group.dispatchEvent(new window.MouseEvent("mouseenter")));
      const popup = document.querySelector("[data-hover-tooltip-portal]");
      const bounds = popup.firstElementChild.getBoundingClientRect();
      assert.equal(bounds.left, triggerRect.right, file);
      assert.equal(bounds.top, triggerRect.top, file);
      assert.notEqual(bounds.left, container.getBoundingClientRect().left);
      assert.equal(popup.style.width, "15px");
      assert.equal(popup.textContent, "Mark Done   E");
      assert.ok(popup.firstElementChild.classList.contains("whitespace-nowrap"), file);
      triggerRect = new window.DOMRect(450, 280, 15, 20);
      await React.act(async () => window.dispatchEvent(new window.Event("scroll")));
      assert.equal(popup.firstElementChild.getBoundingClientRect().left, triggerRect.right);
      assert.equal(popup.firstElementChild.getBoundingClientRect().top, triggerRect.top);
      await React.act(async () => container.querySelector("button").click());
      assert.equal(done, 1);
      assert.equal(opened, 0);
      await React.act(async () => group.dispatchEvent(new window.MouseEvent("mouseleave")));
      assert.equal(document.querySelector("[data-hover-tooltip-portal]"), null);
      setFlag(false);
      await render(React.createElement(Component, props));
      const legacy = container.querySelector(".group > span");
      assert.equal(legacy.getAttribute("style"), null, "flag-off span retains offset-free legacy layout");
      assert.equal(legacy.textContent, "Mark Done   E");
      assert.equal(container.querySelector("button").children.length, 1);
    }
    setFlag(true);
    const ReactTooltip = load("src/components/Common/ReactTooltip.tsx");
    await render(React.createElement("button", null, React.createElement(ReactTooltip, { className: "scale-100" }, "Reaction")));
    const richPopup = document.querySelector("[data-hover-tooltip-portal]");
    assert.equal(richPopup.style.left, `${triggerRect.left}px`, "rich tooltip uses its parent, not offsetParent");
    assert.equal(richPopup.style.width, `${triggerRect.width}px`);
  });
});

test("grouped reaction shortcuts do not overlap when clamped near the viewport bottom", async () => {
  await withTooltipFixture(async ({ load, container, render, observers }) => {
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const nativeBounds = window.HTMLElement.prototype.getBoundingClientRect;
    let rowHeight = 30;
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.id === "reaction-trigger") return new window.DOMRect(100, 570, 20, 20);
      if (this.textContent === "Add ReactionRFast LikeL" && this.classList.contains("flex-col")) {
        const portal = this.parentElement;
        return new window.DOMRect(parseFloat(portal.style.left), parseFloat(portal.style.top) + parseFloat(portal.style.height) + 8, 180, rowHeight * 2 + 5);
      }
      if (this.textContent === "Add ReactionR" || this.textContent === "Fast LikeL") {
        const groupRect = this.parentElement.getBoundingClientRect();
        const index = [...this.parentElement.children].indexOf(this);
        return new window.DOMRect(groupRect.left, groupRect.top + index * (rowHeight + 5), 180, rowHeight);
      }
      return nativeBounds.call(this);
    };
    const Component = load(reactionFile);
    await render(React.createElement("div", { id: "reaction-trigger", className: "relative group" }, React.createElement(Component)));
    await React.act(async () => container.firstElementChild.dispatchEvent(new window.MouseEvent("mouseenter")));
    const popups = document.querySelectorAll("[data-hover-tooltip-portal]");
    assert.equal(popups.length, 1, "both shortcuts share one clamped surface");
    const group = popups[0].firstElementChild;
    const checkBounds = () => {
      const first = group.children[0].getBoundingClientRect();
      const second = group.children[1].getBoundingClientRect();
      assert.ok(first.bottom + 5 <= second.top, "shortcut rows retain their gap");
      assert.ok(first.top >= 0);
      assert.equal(second.bottom, window.innerHeight, "the entire group fits at the bottom edge");
    };
    checkBounds();
    rowHeight = 40;
    const observer = observers.find((entry) => entry.elements.has(group));
    assert.ok(observer, "grouped surface is observed for content resize");
    await React.act(async () => observer.callback());
    checkBounds();
  });
});

test("anchored reaction content measures after popover opening and remeasures on resize", async () => {
  await withTooltipFixture(async ({ load, container, render, observers }) => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    anchor.getBoundingClientRect = () => new window.DOMRect(1000, 700, 14, 14);
    const nativeBounds = window.HTMLElement.prototype.getBoundingClientRect;
    let width = 200;
    let height = 70;
    let measurements = 0;
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("fixed") && this.textContent === "Add ReactionRFast LikeL") {
        assert.equal(this.parentElement.dataset.topLayer, "shown", "no measurement while the native popover is hidden");
        measurements++;
        return new window.DOMRect(0, 0, width, height);
      }
      return nativeBounds.call(this);
    };
    const Component = load(reactionFile);
    await render(React.createElement(Component, { anchorElement: anchor }));
    const surface = document.querySelector("[data-hover-tooltip-portal]").firstElementChild;
    assert.ok(measurements > 0);
    assert.equal(surface.style.left, "824px");
    assert.equal(surface.style.top, "622px");
    width = 300;
    height = 100;
    const observer = observers.find((entry) => entry.elements.has(surface));
    assert.ok(observer);
    const previousMeasurements = measurements;
    await React.act(async () => observer.callback());
    assert.ok(measurements > previousMeasurements);
    assert.equal(surface.style.left, "724px");
    assert.equal(surface.style.top, "592px");
    await render(null);
    assert.equal(container.childElementCount, 0);
    assert.equal(observer.elements.size, 0, "resize observer disconnects on unmount");
  });
});

test("legacy reaction placement retains composer boundaries, clamping and shortcut markup", async () => {
  await withTooltipFixture(async ({ load, container, render, setFlag }) => {
    setFlag(false);
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const composer = document.createElement("div");
    composer.id = "comment";
    document.body.append(composer);
    const nativeBounds = window.HTMLElement.prototype.getBoundingClientRect;
    let width = 200;
    let height = 70;
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      return this.classList.contains("fixed") && this.textContent === "Add ReactionRFast LikeL"
        ? new window.DOMRect(0, 0, width, height) : nativeBounds.call(this);
    };
    const Component = load(reactionFile);
    for (const scenario of [
      { rect: [100, 100, 14, 14], boundary: 500, left: 100, top: 122 },
      { rect: [100, 450, 14, 14], boundary: 500, left: 100, top: 372 },
      { rect: [1000, 700, 14, 14], boundary: null, left: 824, top: 622 },
      { rect: [-10, 20, 14, 14], boundary: 30, left: 0, top: 0 },
      { rect: [1000, 700, 14, 14], boundary: null, width: 300, height: 100, left: 724, top: 592 },
    ]) {
      await render(null);
      width = scenario.width ?? 200;
      height = scenario.height ?? 70;
      anchor.getBoundingClientRect = () => new window.DOMRect(...scenario.rect);
      composer.getBoundingClientRect = () => new window.DOMRect(0, scenario.boundary, 100, 100);
      if (scenario.boundary === null) composer.remove();
      else document.body.append(composer);
      await render(React.createElement(Component, { anchorElement: anchor }));
      const surface = document.querySelector(".fixed");
      assert.equal(surface.style.left, `${scenario.left}px`);
      assert.equal(surface.style.top, `${scenario.top}px`);
      assert.equal(surface.textContent, "Add ReactionRFast LikeL");
      assert.ok(surface.classList.contains("z-[9999]"));
      assert.equal(document.querySelector("[data-hover-tooltip-portal]"), null);
    }
    await render(React.createElement(Component));
    assert.equal(container.children.length, 2, "legacy inline shortcuts stay separate");
    assert.deepEqual([...container.children].map((child) => child.style.bottom), ["-40px", "-75px"]);
    assert.equal(container.textContent, "Add ReactionRFast LikeL");
  });
});

test("real tooltip components escape clipped and transformed ancestors without changing content", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai" });
  const globalKeys = ["window", "document", "React", "IS_REACT_ACT_ENVIRONMENT"];
  const previousGlobals = globalKeys.map((key) => Object.getOwnPropertyDescriptor(global, key));
  const stubPaths = [
    "src/utils/undoActions/helperFuncs.ts",
    "src/utils/helperFunctions/helperFunctions.ts",
    "src/hooks/useFlag.tsx",
    "src/styles/_tooltip-portal.scss",
  ].map((file) => path.join(root, file));
  const previousModules = stubPaths.map((file) => require.cache[file]);
  let reactRoot;
  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.React = React;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    let shown = 0;
    dom.window.HTMLElement.prototype.showPopover = function () { shown++; this.dataset.topLayer = "shown"; };
    dom.window.HTMLElement.prototype.hidePopover = function () { delete this.dataset.topLayer; };
    const nativeMatches = dom.window.Element.prototype.matches;
    dom.window.Element.prototype.matches = function (selector) {
      return selector === ":popover-open" ? this.dataset.topLayer === "shown" : nativeMatches.call(this, selector);
    };
    stubPaths.forEach((file, index) => {
      require.cache[file] = {
        id: file, filename: file, loaded: true,
        exports: [
          { cn: (...classes) => classes.filter(Boolean).join(" ") },
          { formatDateToGMT: () => "5 October 2026, 12:00 GMT" },
          { useFlag: (key) => key === "htpr-6950-tooltip-top-layer" },
          { default: { portal: "tooltip-portal" } },
        ][index],
      };
    });
    const jiti = createJiti(__filename, { interopDefault: true, jsx: true, alias: { "@": path.join(root, "src") } });
    const Tooltip = jiti(path.join(root, "src/components/Common/Tooltip.tsx")).default;
    const ReactTooltip = jiti(path.join(root, "src/components/Common/ReactTooltip.tsx")).default;
    const TimeTooltip = jiti(path.join(root, "src/components/Common/TimeTooltip.tsx")).default;
    const TutorialTooltip = jiti(path.join(root, "src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx")).default;
    const CommentEmojiTooltip = jiti(path.join(root, "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentEmojiTooltip.tsx")).default;
    const container = document.getElementById("root");
    reactRoot = require("react-dom/client").createRoot(container);
    const fixture = (child, group = "group") => React.createElement("div", {
      className: group, style: { overflow: "hidden", transform: "translateX(10px)", position: "relative" },
    }, React.createElement("button", { id: "anchor" }, "Hover", child));
    for (const portal of [false, true]) {
      await React.act(async () => reactRoot.render(fixture(React.createElement(Tooltip, {
        text: "Set tags", keyCombination: ["T"], left: 0, bottom: -40, portal,
      }))));
      assert.equal(document.querySelector("[data-hover-tooltip-portal]"), null, "no hover flag before hover");
      const group = container.firstElementChild;
      await React.act(async () => container.querySelector("#anchor").focus());
      assert.equal(Boolean(document.querySelector("[data-hover-tooltip-portal]")), portal, "focus opening matches the production portal prop");
      await React.act(async () => container.querySelector("#anchor").blur());
      assert.equal(document.querySelector("[data-hover-tooltip-portal]"), null, "focusout closes the portal");
      const trigger = portal ? container.querySelector("#anchor") : group;
      await React.act(async () => trigger.dispatchEvent(new window.MouseEvent("mouseenter")));
      const popup = document.querySelector("[data-hover-tooltip-portal]");
      assert.ok(popup, `portal=${portal} renders on hover`);
      assert.equal(popup.parentElement, document.body);
      assert.equal(group.contains(popup), false);
      assert.equal(popup.getAttribute("popover"), "manual");
      assert.equal(popup.dataset.topLayer, "shown");
      assert.equal(popup.textContent, "Set tagsT");
      await React.act(async () => trigger.dispatchEvent(new window.MouseEvent("mouseleave")));
      assert.equal(document.querySelector("[data-hover-tooltip-portal]"), null);
    }
    await React.act(async () => reactRoot.render(fixture(React.createElement(Tooltip, {
      text: "Named group", keyCombination: [], left: 0, bottom: -40, groupHoverId: "/named",
    }), "group/named")));
    await React.act(async () => container.firstElementChild.dispatchEvent(new window.MouseEvent("mouseenter")));
    assert.equal(document.querySelector("[data-hover-tooltip-portal]").textContent, "Named group");

    await React.act(async () => reactRoot.render(fixture(React.createElement(ReactTooltip, { children: "Hover-only reaction" }))));
    assert.equal(document.querySelector("[data-hover-tooltip-portal]"), null, "rich flags retain group-hover visibility unless the caller forces scale-100");
    await React.act(async () => container.firstElementChild.dispatchEvent(new window.MouseEvent("mouseenter")));
    assert.equal(document.querySelector("[data-hover-tooltip-portal]").textContent, "Hover-only reaction");

    const children = [
      [ReactTooltip, { children: "Alex reacted with smile", className: "scale-100" }, "Alex reacted with smile"],
      [TimeTooltip, { time: new Date("2026-10-05T12:00:00Z"), left: 55, bottom: -5 }, "5 October 2026, 12:00 GMT"],
      [TutorialTooltip, { text: "Type Done", left: -95, top: 15 }, "Type Done"],
      [CommentEmojiTooltip, {}, "Add ReactionRFast LikeL"],
    ];
    for (const [Component, props, content] of children) {
      await React.act(async () => reactRoot.render(fixture(React.createElement(Component, props))));
      await React.act(async () => container.firstElementChild.dispatchEvent(new window.MouseEvent("mouseenter")));
      const popups = [...document.querySelectorAll("[data-hover-tooltip-portal]")];
      assert.ok(popups.length, Component.name);
      assert.equal(popups.map((popup) => popup.textContent).join(""), content);
      popups.forEach((popup) => {
        assert.equal(popup.parentElement, document.body);
        assert.equal(popup.dataset.topLayer, "shown");
      });
    }
    const reactionAnchor = document.createElement("button");
    document.body.append(reactionAnchor);
    reactionAnchor.getBoundingClientRect = () => new window.DOMRect(1000, 700, 14, 14);
    const nativeBounds = window.HTMLElement.prototype.getBoundingClientRect;
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      return this.classList.contains("fixed") && this.textContent === "Add ReactionRFast LikeL"
        ? new window.DOMRect(0, 0, 200, 70) : nativeBounds.call(this);
    };
    try {
      await React.act(async () => reactRoot.render(fixture(React.createElement(CommentEmojiTooltip, { anchorElement: reactionAnchor }))));
      const reactionPopup = document.querySelector("[data-hover-tooltip-portal]");
      assert.equal(reactionPopup.textContent, "Add ReactionRFast LikeL");
      assert.equal(reactionPopup.firstElementChild.style.left, "824px", "anchored reaction flag measures its portaled content on first mount");
      assert.equal(reactionPopup.firstElementChild.style.top, "622px");
    } finally {
      window.HTMLElement.prototype.getBoundingClientRect = nativeBounds;
      reactionAnchor.remove();
    }
    const TooltipPortal = jiti(path.join(root, "src/components/Common/TooltipPortal.tsx")).default;
    await React.act(async () => reactRoot.render(React.createElement("dialog", { open: true },
      React.createElement(TooltipPortal, { interactive: true }, React.createElement("button", null, "Copy email")))));
    const dialog = container.querySelector("dialog");
    assert.equal(dialog.querySelector("[data-hover-tooltip-portal]").parentElement, dialog, "dialog tooltips stay interactive rather than becoming inert");
    assert.ok(shown > 0);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    globalKeys.forEach((key, index) => {
      if (previousGlobals[index]) Object.defineProperty(global, key, previousGlobals[index]);
      else delete global[key];
    });
    stubPaths.forEach((file, index) => {
      if (previousModules[index]) require.cache[file] = previousModules[index];
      else delete require.cache[file];
    });
  }
});
