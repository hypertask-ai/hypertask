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
  const styles = read("src/styles/globals.scss");
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

test("all custom hover implementations use the shared top-layer portal", () => {
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
    assert.doesNotMatch(source, /z-\[999(?:0|9|999999)\]/, file);
  }
  const portal = read("src/components/Common/TooltipPortal.tsx");
  assert.match(portal, /createPortal\(/);
  assert.match(portal, /popover="manual"/);
  assert.match(portal, /showPopover/);
  assert.match(portal, /closest\("dialog\[open\]"\)/);
});

test("real tooltip components escape clipped and transformed ancestors without changing content", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai" });
  const globalKeys = ["window", "document", "React", "IS_REACT_ACT_ENVIRONMENT"];
  const previousGlobals = globalKeys.map((key) => Object.getOwnPropertyDescriptor(global, key));
  const stubPaths = [
    "src/utils/undoActions/helperFuncs.ts",
    "src/utils/helperFunctions/helperFunctions.ts",
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
        exports: index === 0 ? { cn: (...classes) => classes.filter(Boolean).join(" ") } : { formatDateToGMT: () => "5 October 2026, 12:00 GMT" },
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
