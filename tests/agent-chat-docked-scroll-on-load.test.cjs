// HTPR-6099: after a page reload the docked AI chat panel (ticket detail
// page, Agents page) stayed scrolled to the very first message with the
// "jump to bottom" button showing, even though two earlier fixes for this
// ticket had already shipped. Those fixes only touched the standalone
// /agents/chat page (AgentChatClient.tsx); the docked panel is a separate
// component (MessageList.tsx) with its own auto-scroll effect.
//
// The defect: that effect scrolled with behavior "smooth" and then called
// handleMessageListScroll, which reads scrollTop synchronously. An animated
// scroll has not moved the container at that point, so the read sees the
// pre-scroll position, misjudges distance-from-bottom, and shows the "jump
// to bottom" button while the view is still short of the newest message.
//
// The test below renders the real component and models that timing: a
// "smooth" scroll leaves scrollTop where it was (the animation is still
// pending), an "auto" scroll lands immediately. It asserts on where the
// container actually sits when the component takes its measurement, so it
// fails for any change that reintroduces an animated auto-follow scroll,
// regardless of how the effect is written or formatted.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");

const message = (id, content) => ({
  id,
  role: "user",
  content,
  createdAt: new Date().toISOString(),
});

// One reload: the panel mounts with no session yet, then the session list
// arrives with the ticket's own chat and its messages paint in one go.
async function renderReloadAndMeasure({ historyOnFirstPaint = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://app.hypertask.ai/detail/project-15/6099",
  });
  const globalNames = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
    // jiti's JSX transform emits classic React.createElement calls, which
    // the component source itself never imports (Next uses the automatic
    // runtime).
    "React",
  ];
  const previousGlobals = new Map(
    globalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(global, name),
    ]),
  );
  const contextPath = path.join(
    root,
    "src/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context.tsx",
  );
  const itemPath = path.join(root, "src/components/AI_CHAT/MessageItem.tsx");
  const typingPath = path.join(
    root,
    "src/components/AI_CHAT/TypingIndicator.tsx",
  );
  const listPath = path.join(root, "src/components/AI_CHAT/MessageList.tsx");
  const stubbed = [contextPath, itemPath, typingPath, listPath];
  const previousModules = new Map(
    stubbed.map((filename) => [filename, require.cache[filename]]),
  );
  let reactRoot;

  // The list is 300px tall and each message renders 100px, so a real scroll
  // to the bottom has to move scrollTop; landing at 0 means it never did.
  const listBox = { clientHeight: 300, messageHeight: 100 };
  let listElement = null;
  const state = { scrollTop: 0, measuredDistanceFromBottom: null, scrollAttempts: 0 };
  let registeredBeforeFirstScroll = false;
  const scrollHeight = (messageCount) =>
    Math.max(listBox.clientHeight, messageCount * listBox.messageHeight);
  let messageCount = 0;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    global.React = React;
    for (const filename of stubbed) delete require.cache[filename];

    const context = {
      chatMounted: false,
      // Models the real helper in useAiChat.ts: it scrolls the node the
      // component handed over via registerMessageListRef, and returns early
      // while that is still null. Modelling that early return is what makes
      // this test able to fail -- registering the ref after the auto-scroll
      // effects made every mount-time scroll a silent no-op in production.
      // "auto" then lands synchronously, "smooth" animates and so has not
      // moved by the time the next statement runs.
      scrollMessagesToBottom: (behavior = "smooth") => {
        state.scrollAttempts += 1;
        if (!listElement) return;
        if (behavior === "auto") {
          state.scrollTop = scrollHeight(messageCount) - listBox.clientHeight;
        }
      },
      // Stands in for the real handler, which derives the "jump to bottom"
      // button from exactly this distance.
      handleMessageListScroll: () => {
        state.measuredDistanceFromBottom =
          scrollHeight(messageCount) - listBox.clientHeight - state.scrollTop;
      },
      registerMessageListRef: (element) => {
        listElement = element;
        if (element) registeredBeforeFirstScroll ||= state.scrollAttempts === 0;
      },
      copyResponse: () => {},
      createTaskFromResponse: () => {},
      retryStream: () => {},
      editMessage: () => {},
      sessions: [],
      activeSession: null,
      isTyping: false,
    };

    require.cache[contextPath] = {
      id: contextPath,
      filename: contextPath,
      loaded: true,
      exports: { useAiChatContext: () => context },
    };
    for (const [filename, name] of [
      [itemPath, "MessageItem"],
      [typingPath, "TypingIndicator"],
    ]) {
      require.cache[filename] = {
        id: filename,
        filename,
        loaded: true,
        exports: {
          [name]: ({ message: item }) =>
            React.createElement("div", null, item?.content ?? ""),
        },
      };
    }

    const jiti = createJiti(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      jsx: true,
    });
    const { MessageList } = jiti(listPath);

    const container = dom.window.document.getElementById("root");
    reactRoot = createRoot(container);

    const messages = [
      message("m1", "qa retest message 1"),
      message("m2", "qa retest message 2"),
      message("m3", "qa retest message 3"),
      message("m4", "qa retest message 4"),
    ];
    const showHistory = () => {
      messageCount = messages.length;
      context.sessions = [{ id: "session-6099", messages }];
      context.activeSession = "session-6099";
    };

    context.chatMounted = true;
    // Opening an existing thread (and the reload QA reproduced) paints the
    // list and its whole history in ONE commit, so the mount is the only
    // chance to scroll. The two-step variant models the slower reload where
    // the panel is restored open first and the history arrives after.
    if (historyOnFirstPaint) showHistory();
    await React.act(async () => {
      reactRoot.render(React.createElement(MessageList));
    });

    if (!historyOnFirstPaint) {
      showHistory();
      await React.act(async () => {
        reactRoot.render(React.createElement(MessageList));
      });
    }

    return {
      ...state,
      listElement,
      registeredBeforeFirstScroll,
      bottomScrollTop: scrollHeight(messageCount) - listBox.clientHeight,
    };
  } finally {
    try {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
    } finally {
      for (const [filename, previous] of previousModules) {
        if (previous === undefined) delete require.cache[filename];
        else require.cache[filename] = previous;
      }
      dom.window.close();
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor) Object.defineProperty(global, name, descriptor);
        else delete global[name];
      }
    }
  }
}

test("a reload lands the docked chat on the newest message", async () => {
  const result = await renderReloadAndMeasure();

  assert.equal(
    result.scrollTop,
    result.bottomScrollTop,
    "the chat must be at the bottom once its messages paint after a reload; " +
      "an animated (smooth) auto-follow scroll leaves it short",
  );
});

test("the docked chat measures its scroll position only after it has moved", async () => {
  const result = await renderReloadAndMeasure();

  assert.equal(
    result.measuredDistanceFromBottom,
    0,
    "handleMessageListScroll reads scrollTop synchronously, so the scroll " +
      "before it must already have landed, or the 'jump to bottom' button " +
      "shows on a chat that is about to sit at the bottom",
  );
});

test("the docked chat registers its scrollable list", async () => {
  const result = await renderReloadAndMeasure();

  assert.ok(result.listElement, "the message list ref must reach the chat hook");
});

test("the docked chat registers its list before it tries to scroll", async () => {
  const result = await renderReloadAndMeasure();

  assert.ok(
    result.registeredBeforeFirstScroll,
    "scrollMessagesToBottom scrolls the node registered through the chat " +
      "hook, so registering after the auto-scroll effects makes every " +
      "mount-time scroll a silent no-op",
  );
});

test("a chat whose history paints on the first commit still lands at the bottom", async () => {
  const result = await renderReloadAndMeasure({ historyOnFirstPaint: true });

  assert.equal(
    result.scrollTop,
    result.bottomScrollTop,
    "opening an existing thread paints the list and its messages in one " +
      "commit, so the mount-time auto-scroll is the only one that runs; it " +
      "must not be a no-op",
  );
});
