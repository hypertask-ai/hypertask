const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule, root } = require("./helpers/loadModule.cjs");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const flag = "htpr-8334-multi-chat-windows";
const viewport = { width: 1440, height: 900 };
const user = 6;

const {
  CHAT_WINDOW_MAX,
  CHAT_WINDOW_MIN_HEIGHT,
  CHAT_WINDOW_MIN_WIDTH,
  cascadeChatWindowRect,
  chatWindowForSession,
  clampChatWindowRect,
  closeChatWindow,
  createChatWindow,
  moveChatWindowToFront,
  openChatWindowForUser,
  readChatWindows,
  setChatWindowMinimized,
  updateChatWindow,
} = loadModule("src/lib/aiChat/chatWindows.ts");

const window = (index, sessionId = `chat-${index}`) =>
  createChatWindow({ id: `window-${index}`, sessionId, title: null, userId: user }, index, viewport);

test("multi chat windows: the flag ships on for everyone with a fallback to one window", () => {
  const definition = loadModule(`src/lib/flags/definitions/${flag}.ts`).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.kind, "feature");
  assert.ok(definition.description.length > 20);
  assert.ok(definition.releaseRisk.reason.length > 20);
  assert.ok(!definition.releaseRisk.highRisk);
  assert.match(read("src/components/ProviderGlobal/GloablProviders.tsx"), /HTPR_8334_MULTI_CHAT_WINDOWS|ChatWindowStack/);
});

test("multi chat windows: the runtime reads the flag before drawing a second window", () => {
  const source = read("src/hooks/MultiPages/AIChat/useChatWindows.ts");
  assert.match(source, /HTPR_8334_MULTI_CHAT_WINDOWS_FLAG/);
  assert.match(source, /useFlag\(HTPR_8334_MULTI_CHAT_WINDOWS_FLAG\)/);
  assert.match(source, /enabled && desktop/);
  assert.match(source, /MOBILE_VIEWPORT_MAX_PX/);
});

test("multi chat windows: a new window never replaces one that is already open", () => {
  const first = window(0, "chat-a");
  const opened = openChatWindowForUser([first], { id: "window-1", sessionId: "chat-b", title: null, userId: user }, viewport);
  assert.equal(opened.length, 2);
  assert.deepEqual(opened.map((entry) => entry.sessionId), ["chat-a", "chat-b"]);
  assert.deepEqual(opened[0], first);
});

test("multi chat windows: the same conversation is not opened twice", () => {
  const windows = [window(0, "chat-a")];
  const again = openChatWindowForUser(windows, { id: "window-9", sessionId: "chat-a", title: null, userId: user }, viewport);
  assert.equal(again.length, 1);
  assert.equal(again[0].id, "window-0");
  assert.equal(chatWindowForSession(again, "chat-a").id, "window-0");
});

test("multi chat windows: three chats stay open at once", () => {
  let windows = [window(0, "chat-a")];
  windows = openChatWindowForUser(windows, { id: "window-1", sessionId: "chat-b", title: null, userId: user }, viewport);
  windows = openChatWindowForUser(windows, { id: "window-2", sessionId: "chat-c", title: null, userId: user }, viewport);
  assert.equal(windows.length, 3);
  const placements = new Set(windows.map((entry) => `${entry.x}:${entry.y}`));
  assert.equal(placements.size, 3);
  assert.ok(windows.every((entry) => entry.x + entry.width <= viewport.width));
  assert.ok(windows.every((entry) => entry.y + entry.height <= viewport.height));
});

test("multi chat windows: windows stop at the cap instead of piling up over the board", () => {
  let windows = [];
  for (let index = 0; index < CHAT_WINDOW_MAX + 2; index += 1) {
    windows = openChatWindowForUser(windows, { id: `window-${index}`, sessionId: `chat-${index}`, title: null, userId: user }, viewport);
  }
  assert.equal(windows.length, CHAT_WINDOW_MAX);
});

test("multi chat windows: each window keeps its own place", () => {
  const windows = [window(0), window(1)];
  const moved = updateChatWindow(windows, "window-0", { x: 40, y: 60 }, viewport);
  assert.deepEqual({ x: moved[0].x, y: moved[0].y }, { x: 40, y: 60 });
  assert.deepEqual({ x: moved[1].x, y: moved[1].y }, { x: windows[1].x, y: windows[1].y });
});

test("multi chat windows: a window cannot be dragged off the screen", () => {
  const rect = clampChatWindowRect({ x: -900, y: 5000, width: 400, height: 400 }, viewport);
  assert.equal(rect.x, 0);
  assert.ok(rect.y + rect.height <= viewport.height);
  const narrow = clampChatWindowRect({ x: 0, y: 0, width: 20, height: 20 }, viewport);
  assert.equal(narrow.width, CHAT_WINDOW_MIN_WIDTH);
  assert.equal(narrow.height, CHAT_WINDOW_MIN_HEIGHT);
});

test("multi chat windows: a saved set of windows comes back after a reload, clamped to the screen", () => {
  const saved = [window(0, "chat-a"), { ...window(1, "chat-b"), minimized: true, x: 5000 }];
  const restored = readChatWindows(JSON.parse(JSON.stringify(saved)), viewport, user);
  assert.equal(restored.length, 2);
  assert.equal(restored[0].sessionId, "chat-a");
  assert.equal(restored[1].minimized, true);
  assert.ok(restored[1].x + restored[1].width <= viewport.width);
  assert.deepEqual(readChatWindows(JSON.parse(JSON.stringify(saved)), { width: 1024, height: 700 }, user).length, 2);
});

test("multi chat windows: another person's saved windows never open for this person", () => {
  const saved = [window(0, "chat-a"), { ...window(1, "chat-b"), userId: user + 1 }];
  const restored = readChatWindows(saved, viewport, user);
  assert.deepEqual(restored.map((entry) => entry.sessionId), ["chat-a"]);
  assert.deepEqual(readChatWindows("not a list", viewport, user), []);
  assert.deepEqual(readChatWindows([{ id: 5 }, null, "x"], viewport, user), []);
});

test("multi chat windows: another person's saved windows never use up this person's room", () => {
  const foreign = [0, 1, 2, 3].map((index) => ({
    ...createChatWindow({ id: `foreign-${index}`, sessionId: `other-${index}`, title: null, userId: user + 1 }, index, viewport),
  }));
  const opened = openChatWindowForUser(foreign, { id: "window-mine", sessionId: "chat-mine", title: null, userId: user }, viewport);
  assert.equal(opened.length, foreign.length + 1);
  assert.deepEqual(readChatWindows(opened, viewport, user).map((entry) => entry.sessionId), ["chat-mine"]);
  assert.deepEqual(readChatWindows(opened, viewport, user + 1).length, 4);
  const capped = openChatWindowForUser(opened, { id: "window-more", sessionId: "chat-more", title: null, userId: user }, viewport);
  assert.equal(capped.length, opened.length + 1);
  let full = [];
  for (let index = 0; index < 5; index += 1) {
    full = openChatWindowForUser(full, { id: `mine-${index}`, sessionId: `mine-chat-${index}`, title: null, userId: user }, viewport);
  }
  assert.equal(full.length, CHAT_WINDOW_MAX);
});

test("multi chat windows: minimising keeps the window in place and restoring returns it there", () => {
  const windows = [window(0), window(1)];
  const minimized = setChatWindowMinimized(windows, "window-1", true);
  assert.equal(minimized[1].minimized, true);
  assert.deepEqual({ x: minimized[1].x, y: minimized[1].y }, { x: windows[1].x, y: windows[1].y });
  const restored = setChatWindowMinimized(minimized, "window-1", false);
  assert.deepEqual({ x: restored[1].x, y: restored[1].y }, { x: windows[1].x, y: windows[1].y });
});

test("multi chat windows: closing a window leaves the others alone", () => {
  const windows = [window(0, "chat-a"), window(1, "chat-b")];
  const closed = closeChatWindow(windows, "window-0");
  assert.deepEqual(closed.map((entry) => entry.sessionId), ["chat-b"]);
  assert.equal(chatWindowForSession(closed, "chat-a"), undefined);
});

test("multi chat windows: the window that was touched last sits on top", () => {
  const windows = [window(0, "chat-a"), window(1, "chat-b"), window(2, "chat-c")];
  const focused = moveChatWindowToFront(windows, "window-0");
  assert.deepEqual(focused.map((entry) => entry.id), ["window-1", "window-2", "window-0"]);
  assert.equal(moveChatWindowToFront(focused, "window-0"), focused);
});

test("multi chat windows: new windows step away from the one before", () => {
  const first = cascadeChatWindowRect(0, viewport);
  const second = cascadeChatWindowRect(1, viewport);
  assert.notDeepEqual({ x: first.x, y: first.y }, { x: second.x, y: second.y });
  assert.ok(second.x < first.x);
  assert.ok(second.y <= first.y);
});
