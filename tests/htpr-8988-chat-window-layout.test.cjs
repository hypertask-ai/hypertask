const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const { loadModule } = require("./helpers/loadModule.cjs");

const flag = "htpr-8988-chat-window-layout";
const user = 985;
const geometry = loadModule("src/lib/aiChat/chatWindows.ts");

function dialogPresence(container) { return container.querySelector('[role="dialog"]') ? "present" : "absent"; }

function assertSeparate(rects, viewport) {
  assert.ok(rects.length >= 3);
  for (const [i, a] of rects.entries()) {
    assert.ok(a.width > 0 && a.height > 0);
    assert.ok(a.x >= 0 && a.y >= 0);
    assert.ok(a.x + a.width <= viewport.width && a.y + a.height <= viewport.height);
    for (const b of rects.slice(i + 1)) {
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
        `overlap: ${JSON.stringify({ a, b })}`);
    }
  }
}

for (const viewport of [{ width: 1920, height: 1032 }, { width: 1440, height: 900 }, { width: 1024, height: 600 }, { width: 768, height: 500 }]) {
  test(`primary and extra chats never overlap at ${viewport.width}x${viewport.height}`, () => {
    for (const count of [3, 4, 5]) {
      const windows = Array.from({ length: count - 1 }, (_, index) => geometry.createChatWindow({
        id: `window-${index}`, sessionId: `chat-${index}`, title: `Chat ${index}`, userId: user,
      }, index, viewport));
      const foreign = { ...windows[0], id: "foreign", userId: user + 1 };
      const arranged = geometry.arrangeChatWindowsForUser([...windows, foreign], user, viewport);
      assert.equal(arranged.at(-1), foreign);
      const saved = geometry.readChatWindows(JSON.parse(JSON.stringify(arranged)), viewport, user,
        geometry.tileChatWindowRect(0, count, viewport));
      assert.equal(saved.length, count - 1);
      const primary = geometry.tileChatWindowRect(0, count, viewport);
      assertSeparate([primary, ...saved], viewport);
      if (viewport.width === 1920 && count === 3) {
        assert.deepEqual([primary, ...saved].map(({ x, y, width, height }) => ({ x, y, width, height })), [
          { x: 1352, y: 302, width: 560, height: 722 },
          { x: 784, y: 302, width: 560, height: 722 },
          { x: 216, y: 302, width: 560, height: 722 },
        ]);
      }
      assert.equal(geometry.arrangeChatWindowsForUser(arranged, user, viewport), arranged);
      const minimized = geometry.setChatWindowMinimized(saved, "window-0", true);
      const restored = geometry.setChatWindowMinimized(minimized, "window-0", false);
      assert.deepEqual(restored, saved);
      const moved = geometry.updateChatWindow(saved, "window-0", { x: 10, y: 10 }, viewport,
        geometry.tileChatWindowRect(0, count, viewport));
      assert.equal(moved[0].x, 10);
      assert.equal(moved[0].y, 10);
      assert.deepEqual(moved.slice(1), saved.slice(1));
      assert.deepEqual(geometry.closeChatWindow(moved, "window-0").map(({ id }) => id), saved.slice(1).map(({ id }) => id));
    }
  });
}

function stackView({ enabled = true, sidebar = false, verifiedUserId = user } = {}) {
  const view = mount();
  Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 1032, configurable: true });
  const listeners = new Set();
  const values = { user: { id: user }, windows: [], sidebar };
  const notify = () => listeners.forEach(listener => listener());
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const setValue = (key, update) => {
    const next = typeof update === "function" ? update(values[key]) : update;
    if (next === values[key]) return;
    values[key] = next;
    notify();
  };
  values.primary = {
    currentSession: { id: "primary", title: "Primary" }, showAiChatInterface: true, minimized: false,
    minimizeChat: () => setValue("primary", previous => ({ ...previous, minimized: true })),
    restoreChat: () => setValue("primary", previous => ({ ...previous, minimized: false })),
    togglePopover: () => setValue("primary", previous => ({ ...previous, showAiChatInterface: false })),
  };
  const Scope = React.createContext(null);
  let controller;
  const usePrimary = () => React.useSyncExternalStore(subscribe, () => values.primary);
  function ChatWindow() {
    const primary = usePrimary();
    const chat = React.useContext(Scope) ?? primary;
    if (chat.minimized) return React.createElement("button", { onClick: chat.restoreChat }, "Restore Primary");
    return React.createElement("div", { "data-chat-body": chat.currentSession.id },
      React.createElement("div", { "data-chat-window-drag": true }, chat.currentSession.title),
      React.createElement("button", { onClick: chat.minimizeChat, "aria-label": `Minimize ${chat.currentSession.id}` }, "Minimize"),
      React.createElement("button", { onClick: chat.togglePopover, "aria-label": `Close ${chat.currentSession.id}` }, "Close"));
  }
  const load = loader({
    "@/hooks/useFlag": { useFlag: key => key === flag ? enabled : key === "htpr-8334-multi-chat-windows" },
    "@/lib/state": {
      useRecoilState: key => [React.useSyncExternalStore(subscribe, () => values[key]), React.useCallback(update => setValue(key, update), [key])],
    },
    "@/store": { currentUserAtom: "user", aiChatWindowsAtom: "windows", isAiChatSidebarModeAtom: "sidebar" },
    "./aiChatShared": { MOBILE_VIEWPORT_MAX_PX: 768 },
    "@/lib/contexts/Multipages/AI_Agent/chatContext": { useOptionalAiChatContext: usePrimary },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": {
      ChatRuntime: ({ overrides, windowScope, children }) => React.createElement(Scope.Provider,
        { value: { ...values.primary, ...overrides, currentSession: { id: windowScope.windowId, title: windowScope.windowId } } }, children),
    },
    "./ChatWindow": { ChatWindow },
  });
  const { useChatWindows } = load("src/hooks/MultiPages/AIChat/useChatWindows.ts");
  const Stack = load("src/components/AI_CHAT/ChatWindowStack.tsx").default;
  function Harness() {
    controller = useChatWindows(verifiedUserId);
    return React.createElement(Stack, { userId: verifiedUserId });
  }
  view.render(React.createElement(Harness));
  return { ...view, values, get controller() { return controller; } };
}

test("real controller and stack tile three frames, share one minimized dock, restore, move and close independently", () => {
  const view = stackView();
  try {
    React.act(() => { assert.equal(view.controller.open("chat-a"), true); });
    React.act(() => { assert.equal(view.controller.open("chat-b"), true); });
    const frames = () => [...view.container.querySelectorAll('[role="dialog"][aria-label="AI chat window"]')];
    const visible = () => frames().filter(frame => frame.style.display !== "none");
    const rects = () => visible().map(frame => ({ x: parseFloat(frame.style.left), y: parseFloat(frame.style.top), width: parseFloat(frame.style.width), height: parseFloat(frame.style.height) }));
    assert.equal(visible().length, 3);
    assert.equal(frames().filter(frame => frame.parentElement.closest('[role="dialog"]')).length, 0);
    assertSeparate(rects(), { width: 1920, height: 1032 });
    const secondaryIds = view.values.windows.map(({ id }) => id);
    const primaryFrame = view.container.querySelector('[data-chat-body="primary"]').closest('[role="dialog"]');
    React.act(() => primaryFrame.click());
    assert.ok(primaryFrame.classList.contains("z-popup"), "primary can be brought above overlapping secondary windows");
    assert.ok(frames().at(-1).classList.contains("z-floating"));
    React.act(() => frames().at(-1).click());
    assert.ok(primaryFrame.classList.contains("z-floating"), "focusing a secondary returns primary to its normal layer");
    for (const id of ["primary", ...secondaryIds]) {
      const button = view.container.querySelector(`[aria-label="Minimize ${id}"]`);
      const before = frames();
      React.act(() => button.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 })));
      assert.deepEqual(frames(), before, "pointerdown must not move the clicked node before mouseup/click");
      React.act(() => button.click());
    }
    assert.equal(visible().length, 0);
    const docks = view.container.querySelectorAll("[data-chat-window-dock]");
    assert.equal(docks.length, 1);
    assert.equal(docks[0].style.bottom, "var(--quick-tips-clearance, 20px)");
    assert.equal(docks[0].children.length, 3);
    assert.ok(docks[0].classList.contains("flex-nowrap"));
    assert.ok(docks[0].classList.contains("overflow-x-auto"));
    assert.ok(!docks[0].classList.contains("flex-wrap"));
    React.act(() => docks[0].firstElementChild.click());
    assert.equal(visible().length, 1);
    assert.equal(view.values.primary.minimized, false);
    React.act(() => view.container.querySelector("[data-chat-window-dock] > button").click());
    assert.equal(visible().length, 2);
    const untouched = view.values.windows.find(({ id }) => id === secondaryIds[1]);
    const moving = view.values.windows.find(({ id }) => id === secondaryIds[0]);
    const handle = view.container.querySelector(`[data-chat-body="${secondaryIds[0]}"] [data-chat-window-drag]`);
    React.act(() => handle.dispatchEvent(new window.MouseEvent("pointerdown", {
      bubbles: true, button: 0, clientX: moving.x + 10, clientY: moving.y + 10,
    })));
    React.act(() => window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 30, clientY: 40 })));
    React.act(() => window.dispatchEvent(new window.MouseEvent("pointerup")));
    assert.deepEqual([view.values.windows.find(({ id }) => id === secondaryIds[0]).x, view.values.windows.find(({ id }) => id === secondaryIds[0]).y], [20, 30]);
    assert.deepEqual(view.values.windows.find(({ id }) => id === secondaryIds[1]), untouched);
    React.act(() => view.container.querySelector(`[aria-label="Close ${secondaryIds[0]}"]`).click());
    assert.deepEqual(view.values.windows.map(({ id }) => id), [secondaryIds[1]]);
    assert.equal(visible().length, 1);
  } finally { view.close(); }
});

for (const options of [{ sidebar: true }, { verifiedUserId: user + 1 }]) {
  test(`sidebar and another account cannot open floating chats: ${JSON.stringify(options)}`, () => {
    const view = stackView(options);
    try {
      React.act(() => { assert.equal(view.controller.open("chat-a"), false); });
      assert.deepEqual(view.values.windows, []);
      assert.equal(dialogPresence(view.container), "absent");
    } finally { view.close(); }
  });
}

test("layout flag off keeps the primary in the existing panel and retains legacy secondary placement", () => {
  const view = stackView({ enabled: false });
  try {
    assert.equal(dialogPresence(view.container), "absent");
    React.act(() => { assert.equal(view.controller.open("chat-a"), true); });
    assert.equal(view.container.querySelectorAll('[role="dialog"]').length, 1);
    assert.deepEqual([view.values.windows[0].x, view.values.windows[0].y], [1352, 302]);
  } finally { view.close(); }
});
