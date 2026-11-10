const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const FLAG = "htpr-8964-remove-person-hover";
const AGENT = "11111111-2222-3333-4444-555555555555";
const noop = () => {};
const pass = ({ children }) => children;

const floating = {
  useFloating: () => ({ refs: { setFloating: noop, setReference: noop, domReference: { current: null } }, context: {}, floatingStyles: {} }),
  useInteractions: () => ({ getReferenceProps: value => value, getFloatingProps: value => value }),
  FloatingFocusManager: pass,
  FloatingPortal: pass,
};
for (const key of ["autoUpdate", "flip", "offset", "safePolygon", "shift", "useDismiss", "useFocus", "useHover", "useRole"]) floating[key] = noop;

const mocks = (removeHover) => ({
  "@/components/Common/UserAvatar": { default: () => null },
  "./TooltipPortal": { default: pass },
  "@/hooks/MultiPages/usePersonHovercard": { usePersonHovercard: () => ({ isFetching: true }) },
  "next/link": { default: "a" },
  "next/navigation": { usePathname: () => "/project/7049", useRouter: () => ({ replace: noop }) },
  "@/hooks/useFlag": { useFlag: key => key === FLAG ? removeHover : false },
  "@/lib/state": { useSetRecoilState: () => noop },
  "@/store": { isAiChatSidebarModeAtom: "sidebar", aiChatAutoOpenSuppressedAtom: "suppressed", aiChatExplicitOpenAtAtom: "explicit", showAIChatInterfaceAtom: "open" },
  "@floating-ui/react": floating,
});

const mouseEvent = (window, type, pointerType) => {
  const event = new window.MouseEvent(type, { bubbles: type !== "pointerenter" && type !== "pointerleave" });
  if (pointerType) Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
};

const fire = (window, target, type, pointerType) =>
  React.act(async () => { target.dispatchEvent(mouseEvent(window, type, pointerType)); });

test("an assignee or agent row opens no card on mouse hover once the flag is on, and still opens on tap", async () => {
  for (const removeHover of [false, true]) {
    const view = mount();
    const source = loader(mocks(removeHover));
    const { ParentPersonHovercard } = source("src/components/Common/PersonHovercard.tsx");
    view.render(React.createElement(ParentPersonHovercard, { projectId: 7049, subject: { kind: "agent", id: AGENT } }));
    const window = view.container.ownerDocument.defaultView;
    try {
      await fire(window, view.container, "pointerenter", "mouse");
      if (removeHover) {
        assert.doesNotMatch(view.container.textContent, /Loading contact/);
        assert.equal(view.container.getAttribute("aria-expanded"), "false");
        await fire(window, view.container, "click");
        assert.match(view.container.textContent, /Loading contact/);
        assert.equal(view.container.getAttribute("aria-expanded"), "true");
      } else {
        assert.match(view.container.textContent, /Loading contact/);
        assert.equal(view.container.getAttribute("aria-expanded"), "true");
      }
    } finally {
      view.close();
    }
  }
});

test("a mentioned name opens no card on mouse hover once the flag is on, and still opens on tap", async () => {
  for (const removeHover of [false, true]) {
    const view = mount();
    const source = loader(mocks(removeHover));
    const RichTextPersonHovercards = source("src/components/Common/RichTextPersonHovercards.tsx").default;
    view.render(React.createElement(RichTextPersonHovercards, { projectId: 7049 },
      React.createElement("span", { className: "mention", "data-label": `agent-${AGENT}` }, "Runner")));
    const window = view.container.ownerDocument.defaultView;
    try {
      const mention = view.container.querySelector(".mention");
      assert.equal(mention.getAttribute("aria-haspopup"), "dialog");
      await fire(window, mention, "pointerover", "mouse");
      if (removeHover) {
        assert.doesNotMatch(view.container.textContent, /Loading contact/);
        await fire(window, mention, "click");
        assert.match(view.container.textContent, /Loading contact/);
      } else {
        assert.match(view.container.textContent, /Loading contact/);
      }
    } finally {
      view.close();
    }
  }
});

test("the hovercard removal ships as the ticket's own improvement flag at Owner + QA", () => {
  const definition = loader()("src/lib/flags/definitions/htpr-8964-remove-person-hover.ts").default;
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
});
