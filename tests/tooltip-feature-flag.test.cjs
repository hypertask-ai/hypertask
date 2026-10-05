const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const flag = "htpr-6950-tooltip-top-layer";

test("the tooltip feature is registered with its ship date and Owner + QA default", () => {
  const definitions = fs.readFileSync(path.join(root, "src/lib/flags.ts"), "utf8");
  const keys = fs.readFileSync(path.join(root, "src/lib/flags/keys.ts"), "utf8");
  assert.match(keys, /export const HTPR_6950_TOOLTIP_TOP_LAYER_FLAG = "htpr-6950-tooltip-top-layer"/);
  assert.match(definitions, /key: HTPR_6950_TOOLTIP_TOP_LAYER_FLAG,\s+shippedOn: "2026-10-05",\s+description: "Keeps hover tooltips above other interface layers without being clipped or covered\."/);
  assert.match(definitions, /const DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
});

test("flag off renders production tooltips and flag on renders the top-layer portal for every moved component", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div><button id='external'>External anchor</button>", { url: "https://app.hypertask.ai/project" });
  const globals = new Map();
  const browserGlobals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    getComputedStyle: dom.window.getComputedStyle, React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const cached = new Map(Object.entries(require.cache));
  const stub = (file, exports) => {
    const filename = file.startsWith("src/") ? path.join(root, file) : require.resolve(file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  let enabled = false;
  let reactRoot;
  try {
    for (const [key, value] of Object.entries(browserGlobals)) {
      globals.set(key, Object.getOwnPropertyDescriptor(global, key));
      Object.defineProperty(global, key, { configurable: true, writable: true, value });
    }
    window.HTMLElement.prototype.showPopover = function () { this.dataset.topLayer = "shown"; };
    stub("src/hooks/useFlag.tsx", { useFlag: (key) => key === flag && enabled });
    stub("src/components/Common/TooltipPortal.module.scss", { default: { portal: "tooltip-portal" } });
    stub("src/utils/undoActions/helperFuncs.ts", { cn: (...classes) => require("tailwind-merge").twMerge(require("clsx").clsx(classes)) });
    stub("src/utils/helperFunctions/helperFunctions.ts", { formatDateToGMT: () => "5 October 2026, 12:00 GMT", convertToPlain: (text) => text });
    stub("src/utils/generateTime.ts", { default: () => "just now" });
    stub("src/components/Common/UserAvatar.tsx", { default: () => React.createElement("span", null, "Avatar") });
    stub("src/hooks/MultiPages/usePersonHovercard.ts", { usePersonHovercard: () => ({ isFetching: false, isError: false, data: { kind: "user", displayName: "Ada", email: "ada@example.test" } }) });
    stub("next/navigation", { usePathname: () => "/project" });
    const jiti = createJiti(__filename, { interopDefault: true, fsCache: false, alias: { "@": path.join(root, "src") }, jsx: { runtime: "automatic" } });
    const load = (file) => jiti(path.join(root, file));
    const Tooltip = load("src/components/Common/Tooltip.tsx").default;
    const ReactTooltip = load("src/components/Common/ReactTooltip.tsx").default;
    const TimeTooltip = load("src/components/Common/TimeTooltip.tsx").default;
    const TutorialTooltip = load("src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx").default;
    const CommentEmojiTooltip = load("src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentEmojiTooltip.tsx").default;
    const NotificationAssigned = load("src/components/notifications/assigned.tsx").default;
    const NotificationComment = load("src/components/notifications/comment.tsx").default;
    const { default: PersonHovercard, ParentPersonHovercard, PersonHovercardSurface } = load("src/components/Common/PersonHovercard.tsx");
    const external = document.getElementById("external");
    const notification = { id: 1, status: "Normal", createdAt: new Date(), comment: { text: "Comment" } };
    const notificationProps = { notification, markAsDone() {}, openTask() {}, setSelectedInbox() {}, _selectedInbox: null };
    const personProps = { projectId: 15, subject: { kind: "user", userId: 985 } };
    const cases = [
      ["Tooltip inline", Tooltip, { text: "Set tags", keyCombination: ["T"], bottom: -40, left: 0 }, "Set tagsT", "z-[9999]", "hover"],
      ["Tooltip anchored", Tooltip, { text: "Set tags", keyCombination: ["T"], bottom: -40, left: 0, portal: true, anchorElement: external }, "Set tagsT", "z-[9999]"],
      ["ReactTooltip", ReactTooltip, { children: "Ada reacted", className: "scale-100" }, "Ada reacted", "z-[9999]"],
      ["TimeTooltip", TimeTooltip, { time: new Date(), bottom: -5, left: 55 }, "5 October 2026, 12:00 GMT", "z-[9999]"],
      ["TutorialTooltip", TutorialTooltip, { text: "Type Done", top: 15, left: -95 }, "Type Done", "z-[9990]"],
      ["CommentEmojiTooltip inline", CommentEmojiTooltip, {}, "Add ReactionRFast LikeL", "z-[9999]", "hover"],
      ["CommentEmojiTooltip anchored", CommentEmojiTooltip, { anchorElement: external }, "Add ReactionRFast LikeL", "z-[9999]"],
      ["NotificationAssigned", NotificationAssigned, notificationProps, "Mark Done   E", "scale-0", "notification"],
      ["NotificationComment", NotificationComment, notificationProps, "Mark Done   E", "scale-0", "notification"],
      ["PersonHovercardSurface", PersonHovercardSurface, { ...personProps, anchor: external, externallyOpen: true }, "AvatarAdaada@example.test", "z-[999999999]"],
      ["PersonHovercard", PersonHovercard, { ...personProps, children: React.createElement("button", { id: "person" }, "Ada") }, "AvatarAdaada@example.test", "z-[999999999]", "person"],
      ["ParentPersonHovercard", ParentPersonHovercard, personProps, "AvatarAdaada@example.test", "z-[999999999]", "parent"],
    ];
    const baselineDir = process.env.TOOLTIP_BASELINE_DIR;
    const baselineComponents = baselineDir ? new Map([
      ...["Tooltip", "ReactTooltip", "TimeTooltip"].map((name) => [name, jiti(path.join(baselineDir, `src/components/Common/${name}.tsx`)).default]),
      ["TutorialTooltip", jiti(path.join(baselineDir, "src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx")).default],
      ["CommentEmojiTooltip", jiti(path.join(baselineDir, "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentEmojiTooltip.tsx")).default],
      ["NotificationAssigned", jiti(path.join(baselineDir, "src/components/notifications/assigned.tsx")).default],
      ["NotificationComment", jiti(path.join(baselineDir, "src/components/notifications/comment.tsx")).default],
      ...Object.entries(jiti(path.join(baselineDir, "src/components/Common/PersonHovercard.tsx"))).map(([name, component]) => [name === "default" ? "PersonHovercard" : name, component]),
    ]) : null;
    const legacyElements = (legacyClass) => [...document.querySelectorAll("[class]")].filter((element) => {
      if (!element.classList.contains(legacyClass)) return false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.classList.contains(legacyClass)) return false;
      }
      return true;
    });
    const snapshot = (elements) => elements.map((element) => {
      const clone = element.cloneNode(true);
      for (const node of [clone, ...clone.querySelectorAll("*")]) {
        if (node.hasAttribute("class")) node.setAttribute("class", [...node.classList].sort().join(" "));
        // React-generated IDs differ between independent mounts, not between behaviors.
        node.removeAttribute("id");
        node.removeAttribute("aria-labelledby");
      }
      return clone.outerHTML;
    });
    const container = document.getElementById("root");
    reactRoot = require("react-dom/client").createRoot(container);
    const mount = async (Component, props, name, interaction) => {
      await React.act(async () => reactRoot.render(React.createElement("div", {
        className: "group", style: { overflow: "hidden", position: "relative" },
      }, React.createElement(Component, { ...props, key: name }))));
      let trigger = container.firstElementChild;
      if (interaction === "notification") trigger = container.querySelector("button").parentElement;
      if (interaction === "person") trigger = container.querySelector("#person");
      if (interaction === "person" || interaction === "parent") {
        await React.act(async () => { trigger.blur(); trigger.focus(); });
      } else if (interaction) {
        await React.act(async () => trigger.dispatchEvent(new window.MouseEvent("mouseenter")));
      }
    };
    for (const [name, Component, props, text, legacyClass, interaction] of cases) {
      for (const state of [false, true, false]) {
        enabled = state;
        await mount(Component, props, name, interaction);
        const popups = [...document.querySelectorAll("[data-hover-tooltip-portal]")];
        const legacy = legacyElements(legacyClass);
        if (state) {
          assert.ok(popups.length, `${name}: flag on mounts the portal`);
          assert.equal(popups.map((popup) => popup.textContent).join(""), text, name);
          assert.equal(legacy.length, 0, `${name}: flag on does not render the legacy tooltip`);
          popups.forEach((popup) => assert.equal(popup.dataset.topLayer, "shown", name));
        } else {
          assert.equal(popups.length, 0, `${name}: flag off never mounts the new portal`);
          assert.ok(legacy.length, `${name}: flag off retains the production classes`);
          assert.equal(legacy.map((element) => element.textContent).join(""), text, name);
          if (interaction === "notification") assert.ok(legacy[0].classList.contains("group-hover:scale-100"));
          if (baselineComponents) {
            const current = snapshot(legacy);
            await mount(baselineComponents.get(name.split(" ")[0]), props, name, interaction);
            assert.deepEqual(snapshot(legacyElements(legacyClass)), current, `${name}: flag off matches origin/production DOM and styles`);
          }
        }
      }
      await React.act(async () => reactRoot.render(null));
    }
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    dom.window.close();
  }
});
