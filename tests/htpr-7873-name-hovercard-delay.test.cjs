const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const FLAG = "htpr-7873-name-hovercard-delay";
const noop = () => {};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pointer = (type, pointerType, view) => {
  const event = new view.window.Event(type, { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
};

const parentCard = (enabled) => {
  const pass = ({ children }) => children;
  const floating = {
    useFloating: () => ({ refs: { setFloating: noop, setReference: noop, domReference: { current: null } }, context: {}, floatingStyles: {} }),
    useInteractions: () => ({ getReferenceProps: (value) => value, getFloatingProps: (value) => value }),
    FloatingFocusManager: pass, FloatingPortal: pass,
  };
  for (const key of ["autoUpdate", "flip", "offset", "safePolygon", "shift", "useDismiss", "useFocus", "useHover", "useRole"]) floating[key] = noop;
  const source = loader({
    "@/components/Common/UserAvatar": { default: () => null },
    "./TooltipPortal": { default: pass },
    "@/hooks/MultiPages/usePersonHovercard": { usePersonHovercard: () => ({ data: { kind: "user", id: 985, displayName: "Human", email: "qa@example.test" } }) },
    "next/link": { default: "a" },
    "next/navigation": { usePathname: () => "/detail/project-7049/42", useRouter: () => ({ replace: noop }) },
    "@/hooks/useFlag": { useFlag: (key) => key === FLAG && enabled },
    "@/lib/flags/keys": { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: "htpr-7518-agent-sidebar-chats" },
    "@/lib/flags/definitions/htpr-7737-agent-hover-chat": { HTPR_7737_AGENT_HOVER_CHAT_FLAG: "htpr-7737-agent-hover-chat" },
    "@/lib/flags/definitions/htpr-7873-name-hovercard-delay": { HTPR_7873_NAME_HOVERCARD_DELAY_FLAG: FLAG },
    "@/lib/state": { useSetRecoilState: () => noop },
    "@/store": {},
    "@floating-ui/react": floating,
  });
  return source("src/components/Common/PersonHovercard.tsx");
};

const withParentRow = async (enabled, run) => {
  const view = mount();
  try {
    const { ParentPersonHovercard } = parentCard(enabled);
    const Harness = () => React.createElement("div", { id: "row" }, React.createElement("span", null, "Human"), React.createElement(ParentPersonHovercard, { projectId: 7049, subject: { kind: "user", id: 985 } }));
    await view.render(React.createElement(Harness));
    const row = view.container.querySelector("#row");
    Object.defineProperty(row, "matches", { configurable: true, value: (selector) => selector === ":focus-visible" });
    const fire = (type, pointerType, ms = 0) => React.act(async () => {
      row.dispatchEvent(pointer(type, pointerType, window));
      if (ms) await wait(ms);
    });
    await run({ expanded: () => row.getAttribute("aria-expanded"), fire, idle: (ms) => React.act(async () => wait(ms)) });
  } finally { view.close(); }
};

test("definition is an Everyone improvement flag", () => {
  const { createJiti } = require("jiti");
  const path = require("node:path");
  const jiti = createJiti(__filename, { interopDefault: true, fsCache: false });
  const definition = jiti(path.join(__dirname, "../src/lib/flags/definitions/htpr-7873-name-hovercard-delay.ts"));
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
});

test("flag on: a mouse hover opens the card only after the delay", async () => {
  await withParentRow(true, async ({ expanded, fire, idle }) => {
    await fire("pointerenter", "mouse", 120);
    assert.equal(expanded(), "false", "no card at 120ms");
    await idle(350);
    assert.equal(expanded(), "true", "card open after the delay");
  });
});

test("flag on: leaving before the delay never opens the card", async () => {
  await withParentRow(true, async ({ expanded, fire, idle }) => {
    await fire("pointerenter", "mouse", 100);
    await fire("pointerleave", "mouse");
    await idle(500);
    assert.equal(expanded(), "false");
  });
});

test("flag on: keyboard focus waits, a tap opens at once", async () => {
  await withParentRow(true, async ({ expanded, fire, idle }) => {
    await fire("focusin", "keyboard", 120);
    assert.equal(expanded(), "false");
    await idle(350);
    assert.equal(expanded(), "true");
  });
  await withParentRow(true, async ({ expanded, fire }) => {
    await fire("click", "touch");
    assert.equal(expanded(), "true");
  });
});

test("flag off: hover and focus open at once", async () => {
  await withParentRow(false, async ({ expanded, fire }) => {
    await fire("pointerenter", "mouse");
    assert.equal(expanded(), "true");
  });
  await withParentRow(false, async ({ expanded, fire }) => {
    await fire("focusin", "keyboard");
    assert.equal(expanded(), "true");
  });
});

const withMention = async (enabled, run) => {
  const view = mount();
  const names = ["Element", "Node", "MutationObserver"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) Object.defineProperty(global, name, { value: window[name], configurable: true, writable: true });
  try {
    const source = loader({
      "@/components/Common/PersonHovercard": {
        PERSON_HOVERCARD_OPEN_DELAY_MS: 300,
        PersonHovercardSurface: ({ externallyOpen }) => React.createElement("aside", { id: "card", "data-open": String(externallyOpen) }),
      },
      "@/hooks/useFlag": { useFlag: (key) => key === FLAG && enabled },
      "@/lib/flags/definitions/htpr-7873-name-hovercard-delay": { HTPR_7873_NAME_HOVERCARD_DELAY_FLAG: FLAG },
    });
    const RichText = source("src/components/Common/RichTextPersonHovercards.tsx").default;
    await view.render(React.createElement(RichText, { projectId: 7049 }, React.createElement("p", null, React.createElement("span", { className: "mention", "data-label": "name-985", id: "mention" }, "@Human"))));
    const mention = view.container.querySelector("#mention");
    Object.defineProperty(mention, "matches", { configurable: true, value: (selector) => selector === ":focus-visible" });
    const fire = (type, pointerType, ms = 0) => React.act(async () => {
      mention.dispatchEvent(pointer(type, pointerType, window));
      if (ms) await wait(ms);
    });
    await run({ card: () => view.container.querySelector("#card"), fire, idle: (ms) => React.act(async () => wait(ms)) });
  } finally {
    view.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
};

test("flag on: an @mention card waits for the delay and a quick pass never opens it", async () => {
  await withMention(true, async ({ card, fire, idle }) => {
    await fire("pointerover", "mouse", 120);
    assert.equal(card(), null, "no card at 120ms");
    await idle(350);
    assert.equal(card().getAttribute("data-open"), "true");
  });
  await withMention(true, async ({ card, fire, idle }) => {
    await fire("pointerover", "mouse", 100);
    await fire("pointerout", "mouse");
    await idle(500);
    assert.equal(card(), null);
  });
  await withMention(true, async ({ card, fire }) => {
    await fire("click", "touch");
    assert.equal(card().getAttribute("data-open"), "true", "a tap opens at once");
  });
});

test("flag off: an @mention card opens at once", async () => {
  await withMention(false, async ({ card, fire }) => {
    await fire("pointerover", "mouse");
    assert.equal(card().getAttribute("data-open"), "true");
  });
});
