const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { Editor } = require("@tiptap/core");
const { StarterKit } = require("@tiptap/starter-kit");
const { load } = require("./task-route-loader.cjs");

const { useAiChatDraft } = load("src/hooks/MultiPages/AIChat/useAiChatDraft.ts", {});
const { bindAiChatDraft } = load("src/lib/aiChatDraftStore.ts", {});
const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
  "react-hot-toast": { default: { error() {} } },
  "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
  "@/lib/agents/chatViewerState": { sidebarChatHeaders: () => ({}) },
  "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
  "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
  "./aiChatShared": { parseAiStreamErrorContent: (value) => value },
  "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
});

const draftSubmissions = new WeakMap();

async function withComposer(run, enabled = true, initialProps = {}) {
  const dom = new JSDOM("<!doctype html><body><input id='workspace'><div id='root'></div></body>", {
    url: "https://app.hypertask.ai/chat/session-a",
  });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { configurable: true, writable: true, value });
  const original = { fetch: global.fetch, log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  let editor = new Editor({ extensions: [StarterKit], content: "" });
  let reactRoot = createRoot(document.getElementById("root"));
  let props = { userId: 985, sessionId: "session-a", enabled, ...initialProps };
  const companions = [];
  function DraftOwner() {
    draftSubmissions.set(editor, useAiChatDraft(editor, props.userId, props.sessionId, props.enabled, props.agentId));
    return null;
  }
  const render = async (next = {}) => {
    props = { ...props, ...next };
    await act(async () => reactRoot.render(React.createElement(DraftOwner)));
  };
  try {
    await render();
    await run({
      get editor() { return editor; },
      storage: window.localStorage,
      render,
      async companion() {
        const peerEditor = new Editor({ extensions: [StarterKit], content: "" });
        const peerRoot = createRoot(document.body.appendChild(document.createElement("div")));
        function Peer() {
          useAiChatDraft(peerEditor, props.userId, props.sessionId, props.enabled, props.agentId);
          return null;
        }
        companions.push({ root: peerRoot, editor: peerEditor });
        await act(async () => peerRoot.render(React.createElement(Peer)));
        return peerEditor;
      },
      async reload() {
        await act(async () => reactRoot.unmount());
        editor.destroy();
        editor = new Editor({ extensions: [StarterKit], content: "" });
        reactRoot = createRoot(document.getElementById("root"));
        await render();
      },
    });
  } finally {
    for (const peer of companions) {
      await act(async () => peer.root.unmount());
      peer.editor.destroy();
    }
    await act(async () => reactRoot.unmount());
    editor.destroy();
    dom.window.close();
    global.fetch = original.fetch;
    console.log = original.log;
    console.error = original.error;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

function turnContext(editor, overrides = {}) {
  const sent = [];
  const session = { id: "session-a", messages: [] };
  return {
    sent, keepDrafts: true, isByokBlocked: false, isTyping: false, editor,
    captureDraftSubmission: () => draftSubmissions.get(editor)(),
    fileUpload: { fileItems: [], clearFiles() {} },
    messageQueueRef: { current: [] }, setQueuedMessages() {}, sendInFlightRef: { current: false },
    surface: "chat", inViewObject: {}, waitForChatSession: async () => session,
    getDisplayedSession: () => session, currentProject: { id: 15 }, processAttachments: async () => [],
    setIsTyping() {}, addMessageToSessionQuery: (_id, message) => sent.push(message),
    scopedProjectId: 15, isFullScreenChat: true, contextList: [], modelTeamId: null,
    currentAiOption: { id: "model", model: "model", source: "openai" },
    pathname: "/chat/session-a", currentUser: { id: 985 },
    streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null }, streamingRequestRef: { current: null },
    setCurrentStreamingSession() {}, chatRoute: "/api/ai/chat/stream", setAgentStatus() {}, updateSessionTitle() {},
    queryClient: { refetchQueries: async () => {} }, drainQueuedMessage() {}, handleSendMessageRef: { current: null },
    reloadTaskAfterChat: false, updateLastMessageInSessionCache: (_id, message) => sent.push(message),
    appendMessageToSessionCache: (_id, message) => sent.push(message), ...overrides,
  };
}

function streamReply(status = "complete") {
  return new Response(`event: content\ndata: {"content":"Answer"}\n\nevent: done\ndata: {"status":"${status}","assistant_persisted":true}\n\n`);
}

for (const fullScreen of [false, true]) {
  test(`${fullScreen ? "full-screen" : "docked"}: reply completion and queued send preserve the next unsent draft`, async () => {
    await withComposer(async ({ editor, storage, render }) => {
      editor.commands.setContent("<p>First question</p>");
      let reply;
      let drained;
      const context = turnContext(editor, {
        isFullScreenChat: fullScreen,
        pathname: fullScreen ? "/chat/session-a" : "/project/15",
        drainQueuedMessage() {
          if (drained) return;
          drained = createAiChatSend(context).handleSendMessage("Queued question", { htmlForAttachments: "<p>Queued question</p>" });
        },
      });
      let calls = 0;
      global.fetch = async () => {
        if (++calls === 1) return new Promise((resolve) => { reply = resolve; });
        return streamReply();
      };
      const first = createAiChatSend(context).handleSendMessage();
      for (let i = 0; i < 10 && !reply; i++) await Promise.resolve();
      assert.equal(typeof reply, "function");
      assert.equal(editor.getText(), "");
      editor.commands.setContent("<p>My unsent follow-up</p>");
      document.getElementById("workspace").focus();
      await render();
      reply(streamReply());
      assert.equal(await first, true);
      assert.equal(await drained, true);
      assert.equal(editor.getHTML(), "<p>My unsent follow-up</p>");
      assert.equal(storage.getItem("aiChat.draft.985.session-a"), "<p>My unsent follow-up</p>");
      assert.equal(document.activeElement.id, "workspace");
      assert.deepEqual(context.sent.filter((message) => message.role === "human").map((message) => message.content), ["First question", "Queued question"]);
      assert.equal(context.sent.at(-1).content, "Answer");
    });
  });
}

test("drafts return after switching sessions, editor remount and reload without crossing accounts", async () => {
  await withComposer(async (h) => {
    h.editor.commands.setContent("<p><strong>Draft A</strong></p>");
    await h.render({ sessionId: "session-b" });
    assert.equal(h.editor.getText(), "");
    h.editor.commands.setContent("<p>Draft B</p>");
    await h.render({ sessionId: "session-a" });
    assert.equal(h.editor.getHTML(), "<p><strong>Draft A</strong></p>");
    await h.reload();
    assert.equal(h.editor.getHTML(), "<p><strong>Draft A</strong></p>");
    await h.render({ sessionId: "session-b" });
    assert.equal(h.editor.getText(), "Draft B");
    await h.render({ userId: 986 });
    assert.equal(h.editor.getText(), "");
    h.editor.commands.setContent("<p>Other account</p>");
    await h.render({ userId: 985 });
    assert.equal(h.editor.getText(), "Draft B");
  });
});

test("a normal send still clears only the submitted draft and removes its persisted copy", async () => {
  await withComposer(async (h) => {
    h.editor.commands.setContent("<p>Send this</p>");
    global.fetch = async () => streamReply();
    const context = turnContext(h.editor);
    assert.equal(await createAiChatSend(context).handleSendMessage(), true);
    assert.equal(context.sent.find((message) => message.role === "human").content, "Send this");
    assert.equal(h.editor.getText(), "");
    assert.equal(h.storage.getItem("aiChat.draft.985.session-a"), null);
    await h.reload();
    assert.equal(h.editor.getText(), "");
  });
});

test("explicit queueing still clears and stores the queued message without sending yet", async () => {
  await withComposer(async ({ editor, storage }) => {
    editor.commands.setContent("<p>Queue this</p>");
    const context = turnContext(editor, { isTyping: true });
    assert.equal(await createAiChatSend(context).handleSendMessage(), true);
    assert.equal(editor.getText(), "");
    assert.equal(storage.getItem("aiChat.draft.985.session-a"), null);
    assert.deepEqual(context.messageQueueRef.current.map(({ content, html }) => ({ content, html })), [
      { content: "Queue this", html: "<p>Queue this</p>" },
    ]);
  });
});

for (const outcome of ["error", "cancelled", "transport failure"]) {
  test(`${outcome} leaves the draft intact`, async () => {
    await withComposer(async ({ editor, storage }) => {
      editor.commands.setContent("<p>Keep this draft</p>");
      global.fetch = async () => {
        if (outcome === "transport failure") throw new TypeError("Failed to fetch");
        return streamReply(outcome);
      };
      const context = turnContext(editor);
      assert.equal(await createAiChatSend(context).handleSendMessage("Earlier question"), true);
      assert.equal(editor.getText(), "Keep this draft");
      assert.equal(storage.getItem("aiChat.draft.985.session-a"), "<p>Keep this draft</p>");
      assert.equal(context.sent.find((message) => message.role === "human").content, "Earlier question");
      assert.equal(context.sent.at(-1).isDelivered, true);
    });
  });
}

test("edits made while session or attachment preparation waits are not cleared", async () => {
  for (const during of ["session", "attachments", "same-text edit", "same-text session switch"]) {
    await withComposer(async (h) => {
      h.editor.commands.setContent("<p>Original question</p>");
      const context = turnContext(h.editor, {
        async waitForChatSession() {
          if (during === "session") h.editor.commands.setContent("<p>New draft</p>");
          return { id: "session-a", messages: [] };
        },
        async processAttachments() {
          if (during === "attachments") h.editor.commands.setContent("<p>New draft</p>");
          if (during === "same-text edit") {
            h.editor.commands.setContent("<p>Temporary edit</p>");
            h.editor.commands.setContent("<p>Original question</p>");
          }
          if (during === "same-text session switch") {
            await h.render({ sessionId: "session-b" });
            h.editor.commands.setContent("<p>Original question</p>");
          }
          return [];
        },
      });
      global.fetch = async () => streamReply();
      assert.equal(await createAiChatSend(context).handleSendMessage(), true);
      assert.equal(context.sent.find((message) => message.role === "human").content, "Original question");
      assert.equal(h.editor.getText(), during.startsWith("same-text") ? "Original question" : "New draft");
      if (during === "same-text session switch") {
        assert.equal(h.storage.getItem("aiChat.draft.985.session-a"), null);
        assert.equal(h.storage.getItem("aiChat.draft.985.session-b"), "<p>Original question</p>");
        await h.render({ sessionId: "session-a" });
        assert.equal(h.editor.getText(), "");
        await h.render({ sessionId: "session-b" });
        assert.equal(h.editor.getText(), "Original question");
      } else {
        const expected = during === "same-text edit" ? "Original question" : "New draft";
        assert.equal(h.storage.getItem("aiChat.draft.985.session-a"), `<p>${expected}</p>`);
        await h.reload();
        assert.equal(h.editor.getText(), expected);
      }
    });
  }
});

for (const changed of ["remote", "local", "neither"]) {
  test(`submission cleanup after a session round trip preserves ${changed === "neither" ? "no submitted draft" : `a newer ${changed} draft`}`, async () => {
    await withComposer(async (h) => {
      const key = "aiChat.draft.985.session-a";
      h.editor.commands.setContent("<p>Submitted question</p>");
      const context = turnContext(h.editor, {
        async processAttachments() {
          await h.render({ sessionId: "session-b" });
          if (changed === "remote") h.storage.setItem(key, "<p>New remote draft</p>");
          await h.render({ sessionId: "session-a" });
          if (changed === "local") h.editor.commands.setContent("<p>New local draft</p>");
          return [];
        },
      });
      global.fetch = async () => streamReply();
      assert.equal(await createAiChatSend(context).handleSendMessage(), true);
      const expected = changed === "neither" ? "" : `New ${changed} draft`;
      assert.equal(h.editor.getText(), expected);
      assert.equal(h.storage.getItem(key), expected ? `<p>${expected}</p>` : null);
      await h.reload();
      assert.equal(h.editor.getText(), expected);
    });
  });
}

test("typing before initial session hydration is kept, and storage failure still permits chat switches", async () => {
  await withComposer(async (h) => {
    h.storage.setItem("aiChat.draft.985.session-a", "<p>Stale saved draft</p>");
    h.editor.commands.setContent("<p>Typed while loading</p>");
    await h.render({ sessionId: "session-a" });
    assert.equal(h.editor.getText(), "Typed while loading");
    await h.render({ sessionId: null });
    h.editor.commands.setContent("<p>Kept through hydration</p>");
    await h.render({ sessionId: "session-a" });
    assert.equal(h.editor.getText(), "Kept through hydration");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
    await h.render({ sessionId: "session-b" });
    h.editor.commands.setContent("<p>Works without storage</p>");
    await h.render({ sessionId: "session-a" });
    assert.equal(h.editor.getText(), "Kept through hydration");
    await h.render({ sessionId: "session-b" });
    assert.equal(h.editor.getText(), "Works without storage");
  }, true, { sessionId: null });
});

test("flag off keeps the previous background-send clearing behavior and does not persist drafts", async () => {
  await withComposer(async ({ editor, storage, render }) => {
    editor.commands.setContent("<p>Legacy draft</p>");
    await render({ sessionId: "session-b" });
    assert.equal(editor.getText(), "Legacy draft");
    global.fetch = async () => streamReply();
    const context = turnContext(editor, { keepDrafts: false });
    assert.equal(await createAiChatSend(context).handleSendMessage("Queued question"), true);
    assert.equal(editor.getText(), "");
    assert.equal(storage.length, 0);
    assert.equal(context.sent.find((message) => message.role === "human").content, "Queued question");
  }, false);
});

test("native agent drafts migrate as plain text when session metadata arrives and are not resurrected after sending", async () => {
  await withComposer(async (h) => {
    h.storage.setItem("agentChat.draft.985.native", "Use <strong>literal text</strong>\nNext line");
    await h.render({ agentId: "native" });
    assert.equal(h.editor.getHTML(), "<p>Use &lt;strong&gt;literal text&lt;/strong&gt;</p><p>Next line</p>");
    assert.equal(h.storage.getItem("aiChat.draft.985.session-a"), h.editor.getHTML());
    assert.equal(h.storage.getItem("agentChat.draft.985.native"), null);
    await h.reload();
    assert.equal(h.editor.getText(), "Use <strong>literal text</strong>\n\nNext line");
    global.fetch = async () => streamReply();
    assert.equal(await createAiChatSend(turnContext(h.editor)).handleSendMessage(), true);
    await h.reload();
    assert.equal(h.editor.getText(), "");
    assert.equal(h.storage.getItem("aiChat.draft.985.session-a"), null);
  });
});

for (const existing of ["session draft", "typed while loading"]) {
  test(`legacy migration preserves ${existing}`, async () => {
    await withComposer(async (h) => {
      h.storage.setItem("agentChat.draft.985.native", "Older native draft");
      if (existing === "session draft") h.storage.setItem("aiChat.draft.985.session-a", "<p>Session draft</p>");
      else h.editor.commands.setContent("<p>Typed while loading</p>");
      await h.render({ sessionId: "session-a", agentId: "native" });
      assert.equal(h.editor.getText(), existing === "session draft" ? "Session draft" : "Typed while loading");
      await h.reload();
      assert.equal(h.editor.getText(), existing === "session draft" ? "Session draft" : "Typed while loading");
    }, true, { sessionId: null });
  });
}

for (const leave of ["switch", "unmount"]) {
  test(`an untouched composer cannot erase a newer tab's draft on ${leave}`, async () => {
    await withComposer(async (h) => {
      h.storage.setItem("aiChat.draft.985.session-a", "<p>Written in another tab</p>");
      if (leave === "switch") {
        await h.render({ sessionId: "session-b" });
        await h.render({ sessionId: "session-a" });
      } else await h.reload();
      assert.equal(h.editor.getText(), "Written in another tab");
      assert.equal(h.storage.getItem("aiChat.draft.985.session-a"), "<p>Written in another tab</p>");
    });
  });
}

test("storage notifications synchronize clean composers, including remote deletion and account isolation", async () => {
  await withComposer(async (h) => {
    h.editor.commands.setContent("<p>Original draft</p>");
    h.storage.setItem("aiChat.draft.985.session-a", "<p>Newer draft</p>");
    window.dispatchEvent(new window.StorageEvent("storage", { key: "aiChat.draft.986.session-a" }));
    assert.equal(h.editor.getText(), "Original draft");
    window.dispatchEvent(new window.StorageEvent("storage", { key: "aiChat.draft.985.session-a" }));
    assert.equal(h.editor.getText(), "Newer draft");
    h.storage.removeItem("aiChat.draft.985.session-a");
    window.dispatchEvent(new window.StorageEvent("storage", { key: "aiChat.draft.985.session-a" }));
    assert.equal(h.editor.getText(), "");
    await h.render({ sessionId: "session-b" });
    await h.render({ sessionId: "session-a" });
    assert.equal(h.editor.getText(), "");
  });
});

test("conflicted local edits survive continued typing, switches and reload without overwriting the remote draft", async () => {
  await withComposer(async (h) => {
    const key = "aiChat.draft.985.session-a";
    h.editor.commands.setContent("<p>Original draft</p>");
    h.storage.setItem(key, "<p>Newer draft</p>");
    h.editor.commands.setContent("<p>Stale local edit</p>");
    assert.equal(h.storage.getItem(key), "<p>Newer draft</p>");
    assert.equal(window.sessionStorage.getItem(key), "<p>Stale local edit</p>");
    window.dispatchEvent(new window.StorageEvent("storage", { key }));
    assert.equal(h.editor.getText(), "Stale local edit");
    h.editor.commands.setContent("<p>Continued local edit</p>");
    await h.render({ sessionId: "session-b" });
    assert.equal(h.editor.getText(), "");
    h.editor.commands.setContent("<p>Draft B</p>");
    await h.render({ sessionId: "session-a" });
    assert.equal(h.editor.getText(), "Continued local edit");
    await h.reload();
    assert.equal(h.editor.getText(), "Continued local edit");
    h.editor.commands.setContent("<p>Typed after recovery</p>");
    await h.reload();
    assert.equal(h.editor.getText(), "Typed after recovery");
    assert.equal(h.storage.getItem(key), "<p>Newer draft</p>");
    await h.render({ userId: 986 });
    assert.equal(h.editor.getText(), "");
    await h.render({ userId: 985 });
    assert.equal(h.editor.getText(), "Typed after recovery");
  });
});

for (const reload of [false, true]) {
  test(`sending a recovered local draft preserves the remote draft${reload ? " after reload" : ""}`, async () => {
    await withComposer(async (h) => {
      const key = "aiChat.draft.985.session-a";
      h.editor.commands.setContent("<p>Original draft</p>");
      h.storage.setItem(key, "<p>Remote draft</p>");
      h.editor.commands.setContent("<p>Recovered local draft</p>");
      if (reload) await h.reload();
      global.fetch = async () => streamReply();
      const context = turnContext(h.editor);
      assert.equal(await createAiChatSend(context).handleSendMessage(), true);
      assert.equal(context.sent.find((message) => message.role === "human").content, "Recovered local draft");
      assert.equal(h.storage.getItem(key), "<p>Remote draft</p>");
      assert.equal(window.sessionStorage.getItem(key), null);
      assert.equal(h.editor.getText(), "Remote draft");
      await h.reload();
      assert.equal(h.editor.getText(), "Remote draft");
      h.editor.commands.setContent("<p>Resumed shared saving</p>");
      assert.equal(h.storage.getItem(key), "<p>Resumed shared saving</p>");
    });
  });
}

test("matching the remote revision resolves local recovery and resumes shared saves", async () => {
  await withComposer(async (h) => {
    const key = "aiChat.draft.985.session-a";
    h.editor.commands.setContent("<p>Original draft</p>");
    h.storage.setItem(key, "<p>Remote draft</p>");
    h.editor.commands.setContent("<p>Local edit</p>");
    h.editor.commands.setContent("<p>Remote draft</p>");
    assert.equal(window.sessionStorage.getItem(key), null);
    h.editor.commands.setContent("<p>Shared edit</p>");
    assert.equal(h.storage.getItem(key), "<p>Shared edit</p>");
    await h.reload();
    assert.equal(h.editor.getText(), "Shared edit");
  });
});

test("two composers in one window synchronize writes and clearing without cleanup resurrecting drafts", async () => {
  await withComposer(async (h) => {
    const peer = await h.companion();
    h.editor.commands.setContent("<p>Main composer</p>");
    assert.equal(peer.getText(), "Main composer");
    peer.commands.setContent("<p>Peer composer</p>");
    assert.equal(h.editor.getText(), "Peer composer");
    peer.commands.clearContent();
    assert.equal(h.editor.getText(), "");
    assert.equal(h.storage.getItem("aiChat.draft.985.session-a"), null);
    await h.reload();
    assert.equal(h.editor.getText(), "");
    assert.equal(peer.getText(), "");
  });
});

test("the draft store restores, saves and detaches without React ownership", async () => {
  await withComposer(async ({ editor, storage }) => {
    const key = "aiChat.draft.985.session-a";
    storage.setItem(key, "<p>Saved draft</p>");
    const drafts = { current: new Map() };
    const previousBinding = { current: null };
    const binding = bindAiChatDraft(editor, 985, "session-a", drafts, previousBinding);
    try {
      assert.equal(editor.getHTML(), "<p>Saved draft</p>");
      editor.commands.setContent("<p>Updated draft</p>");
      assert.equal(storage.getItem(key), "<p>Updated draft</p>");
      assert.equal(drafts.current.get(key), "<p>Updated draft</p>");
    } finally {
      binding.cleanup();
    }
    editor.commands.setContent("<p>Detached edit</p>");
    storage.setItem(key, "<p>Remote draft</p>");
    window.dispatchEvent(new window.StorageEvent("storage", { key }));
    window.dispatchEvent(new window.Event("aiChatDraftChanged"));
    assert.equal(editor.getHTML(), "<p>Detached edit</p>");
    assert.equal(drafts.current.get(key), "<p>Updated draft</p>");
    assert.equal(storage.getItem(key), "<p>Remote draft</p>");
  }, false);
});

test("the ticket flag supplies Everyone bugfix defaults and release risk", () => {
  const { default: definition } = load("src/lib/flags/definitions/htpr-7770-ai-chat-drafts.ts", {});
  assert.equal(definition.key, "htpr-7770-ai-chat-drafts");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
