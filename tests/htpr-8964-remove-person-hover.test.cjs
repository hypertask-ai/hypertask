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

const mouseEvent = (window, type) => {
  const event = new window.MouseEvent(type, { bubbles: type !== "pointerenter" && type !== "pointerleave" });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  return event;
};

const hover = (window, target, type = "pointerenter") =>
  React.act(async () => { target.dispatchEvent(mouseEvent(window, type)); });

test("hovering a name or agent opens no card once the hovercard is removed", async () => {
  for (const removeHover of [false, true]) {
    const view = mount();
    const source = loader(mocks(removeHover));
    const { ParentPersonHovercard } = source("src/components/Common/PersonHovercard.tsx");
    view.render(React.createElement(ParentPersonHovercard, { projectId: 7049, subject: { kind: "agent", id: AGENT } }));
    try {
      await hover(view.container.ownerDocument.defaultView, view.container);
      if (removeHover) {
        assert.doesNotMatch(view.container.textContent, /Loading contact/);
        assert.equal(view.container.querySelector("[aria-haspopup]"), null);
        assert.equal(view.container.querySelector("[aria-expanded]"), null);
      } else {
        assert.match(view.container.textContent, /Loading contact/);
        assert.equal(view.container.querySelector("[aria-haspopup]"), "dialog");
      }
    } finally {
      view.close();
    }
  }
});

test("hovering a mentioned name opens no card once the hovercard is removed", async () => {
  for (const removeHover of [false, true]) {
    const view = mount();
    const source = loader(mocks(removeHover));
    const RichTextPersonHovercards = source("src/components/Common/RichTextPersonHovercards.tsx").default;
    view.render(React.createElement(RichTextPersonHovercards, { projectId: 7049 },
      React.createElement("span", { className: "mention", "data-label": `agent-${AGENT}` }, "Runner")));
    try {
      const mention = view.container.querySelector(".mention");
      await hover(view.container.ownerDocument.defaultView, mention, "pointerover");
      if (removeHover) {
        assert.doesNotMatch(view.container.textContent, /Loading contact/);
        assert.equal(mention.getAttribute("aria-haspopup"), null);
      } else {
        assert.match(view.container.textContent, /Loading contact/);
        assert.equal(mention.getAttribute("aria-haspopup"), "dialog");
      }
    } finally {
      view.close();
    }
  }
});

test("the hovercard removal ships at Owner + QA as the ticket's own improvement flag", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/lib/flags/definitions/htpr-8964-remove-person-hover.ts"),
    "utf8",
  );
  assert.match(source, /HTPR_8964_REMOVE_PERSON_HOVER_FLAG = "htpr-8964-remove-person-hover"/);
  assert.match(source, /kind: "improvement"/);
  assert.match(source, /defaultMode: "OWNER_AND_QA"/);
});
