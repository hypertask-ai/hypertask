const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flag = "htpr-6950-tooltip-top-layer";

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:tsx?|jsx?|s?css)$/.test(file) ? [file] : [];
  });
}

test("every moved tooltip renders the top-layer portal", async () => {
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
  let reactRoot;
  try {
    for (const [key, value] of Object.entries(browserGlobals)) {
      globals.set(key, Object.getOwnPropertyDescriptor(global, key));
      Object.defineProperty(global, key, { configurable: true, writable: true, value });
    }
    window.HTMLElement.prototype.showPopover = function () { this.dataset.topLayer = "shown"; };
    stub("src/utils/undoActions/helperFuncs.ts", { cn: (...classes) => require("tailwind-merge").twMerge(require("clsx").clsx(classes)) });
    stub("src/utils/helperFunctions/helperFunctions.ts", { formatDateToGMT: () => "5 October 2026, 12:00 GMT", convertToPlain: (text) => text });
    stub("src/utils/generateTime.ts", { default: () => "just now" });
    stub("src/components/Common/UserAvatar.tsx", { default: () => React.createElement("span", null, "Avatar") });
    stub("src/hooks/MultiPages/usePersonHovercard.ts", { usePersonHovercard: () => ({ isFetching: false, isError: false, data: { kind: "user", displayName: "Ada", email: "ada@example.test" } }) });
    stub("next/navigation", { usePathname: () => "/project", useRouter: () => ({ replace: assert.fail }) });
    stub("src/lib/state.tsx", { useSetRecoilState: () => assert.fail });
    stub("src/store/index.ts", {});
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
      ["Tooltip inline", Tooltip, { text: "Set tags", keyCombination: ["T"], bottom: -40, left: 0 }, "Set tagsT", "hover"],
      ["Tooltip anchored", Tooltip, { text: "Set tags", keyCombination: ["T"], bottom: -40, left: 0, portal: true, anchorElement: external }, "Set tagsT"],
      ["ReactTooltip", ReactTooltip, { children: "Ada reacted", className: "scale-100" }, "Ada reacted"],
      ["TimeTooltip", TimeTooltip, { time: new Date(), bottom: -5, left: 55 }, "5 October 2026, 12:00 GMT"],
      ["TutorialTooltip", TutorialTooltip, { text: "Type Done", top: 15, left: -95 }, "Type Done"],
      ["CommentEmojiTooltip inline", CommentEmojiTooltip, {}, "Add ReactionRFast LikeL", "hover"],
      ["CommentEmojiTooltip anchored", CommentEmojiTooltip, { anchorElement: external }, "Add ReactionRFast LikeL"],
      ["NotificationAssigned", NotificationAssigned, notificationProps, "Mark Done   E", "notification"],
      ["NotificationComment", NotificationComment, notificationProps, "Mark Done   E", "notification"],
      ["PersonHovercardSurface", PersonHovercardSurface, { ...personProps, anchor: external, externallyOpen: true }, "AvatarAdaada@example.test"],
      ["PersonHovercard", PersonHovercard, { ...personProps, children: React.createElement("button", { id: "person" }, "Ada") }, "AvatarAdaada@example.test", "person"],
      ["ParentPersonHovercard", ParentPersonHovercard, personProps, "AvatarAdaada@example.test", "parent"],
    ];
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
    await test("a null shortcut list still renders one hint without a key container", async () => {
      await mount(Tooltip, { text: "Set cycle", keyCombination: null, bottom: -40, left: 0 }, "null shortcuts", "hover");
      const tooltips = [...document.querySelectorAll("[data-hover-tooltip-portal]")];
      assert.equal(tooltips.length, 1);
      assert.equal(tooltips[0].textContent, "Set cycle");
      assert.equal(tooltips[0].querySelectorAll("kbd").length, 0);
      assert.equal(tooltips[0].querySelector("span").parentElement.children.length, 1, "no shortcut container");
      await React.act(async () => reactRoot.render(null));
    });
    for (const [name, Component, props, text, interaction] of cases) {
      await mount(Component, props, name, interaction);
      const popups = [...document.querySelectorAll("[data-hover-tooltip-portal]")];
      assert.ok(popups.length, `${name} mounts the top-layer portal`);
      assert.equal(popups.map((popup) => popup.textContent).join(""), text, name);
      popups.forEach((popup) => assert.equal(popup.dataset.topLayer, "shown", name));
      await React.act(async () => reactRoot.render(null));
      assert.equal(document.querySelectorAll("[data-hover-tooltip-portal]").length, 0, `${name} unmounts with its trigger`);
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

test("the retired tooltip top-layer flag is gone from the app source", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions/htpr-6950-tooltip-top-layer.ts")), false);
  for (const file of sourceFiles(path.join(root, "src"))) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), new RegExp(flag), path.relative(root, file));
  }
  const migration = fs.readdirSync(path.join(root, "src/prisma/migrations"))
    .find((name) => name.endsWith("_drop_htpr_6950_tooltip_top_layer_flag"));
  assert.ok(migration, "the flag row is dropped by its own migration");
  assert.equal(read(`src/prisma/migrations/${migration}/migration.sql`), `DELETE FROM "FeatureFlag" WHERE "key" = '${flag}';\n`);
});
