const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const noop = () => {};
const hooks = { useCallback: (fn) => fn, useEffect: noop, useRef: (current) => ({ current }) };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function chatFixture(fullScreen, persistent = false) {
  const state = { draft: "first", html: "<p>first</p>", queued: [], payloads: [], created: [], messages: [], processed: [], errors: [] };
  let session = { id: "active-chat", userId: 985, agentId: null, taskId: null, messages: [] };
  const fileUpload = {
    fileItems: [],
    clearFiles() { fileUpload.fileItems = []; },
    resetFiles(files) { fileUpload.fileItems = files; },
    setFileItems(update) { fileUpload.fileItems = update(fileUpload.fileItems); },
  };
  const context = {
    isByokBlocked: false, isTyping: false, isFullScreenChat: fullScreen,
    surface: fullScreen ? "chat" : "board", pathname: fullScreen ? "/chat/active-chat" : "/project",
    currentUser: { id: 985 }, currentProject: { id: 15 }, scopedProjectId: 15, dockedProjectId: 15,
    currentAiOption: { id: "fixture", model: "fixture", source: "openai" }, contextList: [],
    editor: {
      getText: () => state.draft, getHTML: () => state.html,
      get isEmpty() { return !state.draft && !state.html; },
      commands: {
        clearContent() { state.draft = ""; state.html = ""; },
        setContent(html) { state.draft = html.replace(/<[^>]*>/g, ""); state.html = html; },
      },
    },
    getDisplayedSession: () => session,
    clearMessageQueue() { context.messageQueueRef.current = []; state.queued = []; },
    selectSessionInHistory(id) {
      session = { ...session, id };
      context.sessionsRef.current = [session];
      if (context.persistentQueue) context.persistentQueue.sessionId = id;
    },
    fileUpload, messageQueueRef: { current: [] }, sendInFlightRef: { current: false },
    setQueuedMessages(items) { state.queued = items; },
    handleSendMessageRef: { current: null },
    streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null },
    streamingRequestRef: { current: null }, setCurrentStreamingSession: noop,
    processAttachments: async (html, files) => {
      state.processed.push({ html, files });
      return files.map(({ file }) => ({ fileName: file.name, mimeType: file.type, url: `data:${file.name}` }));
    },
    setIsTyping: noop, setAgentStatus: noop,
    setAiChatBoardSessionMap: noop, updateSessionTitle: noop,
    addMessageToSessionQuery(id, message) { state.messages.push({ id, message }); },
    appendMessageToSessionCache: assert.fail, updateLastMessageInSessionCache: assert.fail,
    chatRoute: "/api/ai/chat/stream", sessionPagingEnabled: false,
    modelBilling: null, dockedChatScope: null, sessionContextKey: "fixture", agentSidebarChatsEnabled: false,
    sessionSetupRef: { current: null }, sessionIntentGenerationRef: { current: 0 },
    resolvedBoardSessionRef: { current: null }, previousProjectIdRef: { current: 15 },
    sessionsRef: { current: [session] }, chatHistoryReadyRef: { current: true }, aiChatBoardSessionMap: {},
    createSession() {
      const nested = { id: "nested-chat", parentSessionId: session.id, messages: [] };
      state.created.push(nested);
      return Promise.resolve(nested);
    },
  };
  if (persistent) {
    const values = new Map();
    const { createSessionMessageQueue } = load("src/lib/aiChat/sessionMessageQueue.ts", {});
    context.persistentQueue = createSessionMessageQueue(985, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }, noop);
    context.persistentQueue.sessionId = session.id;
  }
  const { useAiChatSessions } = load("src/hooks/MultiPages/AIChat/useAiChatSessions.ts", {
    react: hooks,
    "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => null },
    "@/lib/constants": { default: { sendAiChatMessageRoute: context.chatRoute } },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => fileUpload },
    "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
  });
  const queues = useAiChatSessions(context);
  context.waitForChatSession = queues.ensureSessionForCurrentBoard;
  context.drainQueuedMessage = queues.drainQueuedMessage;
  context.handleSendMessageRef = queues.handleSendMessageRef;
  const streams = [];
  const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
    "./aiChatStream": { consumeAiChatStream: async () => {
      const stream = deferred();
      streams.push(stream);
      await stream.promise;
    } },
    "react-hot-toast": { default: { error: (message) => state.errors.push(message) } },
    "@/lib/agents/chatViewerState": { sidebarChatHeaders: () => ({}) },
    "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
  });
  const renderSender = () => createAiChatSend({
    ...context,
    fileUpload: { ...fileUpload, fileItems: [...fileUpload.fileItems] },
  }, { preserveComposer: true, onSettled: noop });
  const sender = renderSender();
  return { state, context, streams, queues, sender, renderSender };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function withChat(fullScreen, check, persistent = false) {
  const fixture = chatFixture(fullScreen, persistent);
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, "/api/ai/chat/stream");
    fixture.state.payloads.push(JSON.parse(options.body));
    return new Response("fixture stream");
  };
  try {
    await check(fixture);
  } finally {
    fixture.context.messageQueueRef.current = [];
    for (const stream of fixture.streams) stream.resolve();
    await settle();
    global.fetch = originalFetch;
  }
}

for (const fullScreen of [false, true]) {
  const surface = fullScreen ? "full-screen" : "sidebar";

  test(`${surface}: a busy send queues before typing state catches up, with cancellable FIFO delivery in the same session`, async () => {
    await withChat(fullScreen, async ({ state, context, streams, queues, sender, renderSender }) => {
      const first = sender.handleSendMessage();
      assert.equal(context.sendInFlightRef.current, true);
      state.draft = "second";
      state.html = "<p>second</p>";
      assert.equal(await sender.handleSendMessage(), true);
      assert.deepEqual(state.queued.map((item) => [item.content, item.html]), [["second", "<p>second</p>"]]);
      assert.equal(state.draft, "");
      await settle();
      assert.deepEqual(state.payloads.map((item) => [item.message, item.session_id]), [["first", "active-chat"]]);
      assert.deepEqual(state.created, []);

      context.isTyping = true;
      const streamingSender = renderSender();
      assert.equal(await streamingSender.handleSendMessage("cancel this"), true);
      assert.equal(await streamingSender.handleSendMessage("third"), true);
      assert.deepEqual(state.queued.map((item) => item.content), ["second", "cancel this", "third"]);
      queues.removeQueuedMessage(state.queued[1].id);
      assert.deepEqual(state.queued.map((item) => item.content), ["second", "third"]);

      streams[0].resolve();
      assert.equal(await first, true);
      await settle();
      assert.deepEqual(state.payloads.map((item) => [item.message, item.session_id]), [
        ["first", "active-chat"], ["second", "active-chat"],
      ]);
      assert.deepEqual(state.queued.map((item) => item.content), ["third"]);
      streams[1].resolve();
      await settle();
      assert.deepEqual(state.payloads.map((item) => [item.message, item.session_id]), [
        ["first", "active-chat"], ["second", "active-chat"], ["third", "active-chat"],
      ]);
      streams[2].resolve();
      await settle();
      assert.deepEqual(state.queued, []);
      assert.deepEqual(state.created, []);
      assert.equal(context.sendInFlightRef.current, false);
    });
  });

  for (const preparationStage of ["session", "attachments"]) {
    test(`${surface}: repeated submit during ${preparationStage} preparation does not queue the active draft`, async () => {
      await withChat(fullScreen, async ({ state, context, streams, queues, renderSender }) => {
        const preparation = deferred();
        if (preparationStage === "session") {
          context.waitForChatSession = () => preparation.promise;
        } else {
          const processAttachments = context.processAttachments;
          context.processAttachments = async (...args) => {
            await preparation.promise;
            return processAttachments(...args);
          };
        }
        const first = renderSender().handleSendMessage();
        assert.equal(state.draft, "");
        assert.equal(state.html, "");
        await settle();
        assert.equal(await renderSender().handleSendMessage(), false);
        assert.deepEqual(state.queued, []);
        state.draft = "new unsent draft";
        state.html = "<p>new <strong>unsent</strong> draft</p>";
        preparation.resolve(await queues.ensureSessionForCurrentBoard());
        await settle();
        assert.deepEqual(state.payloads.map(({ message }) => message), ["first"]);
        assert.deepEqual(state.processed, [{ html: "<p>first</p>", files: [] }]);
        assert.equal(state.draft, "new unsent draft");
        assert.equal(state.html, "<p>new <strong>unsent</strong> draft</p>");
        streams[0].resolve();
        assert.equal(await first, true);
        await settle();
        assert.deepEqual(state.queued, []);
        assert.equal(state.payloads.length, 1);
      });
    });
  }

  for (const persistent of [false, true]) {
    for (const transition of ["different session", "new intent in the same session"]) {
      test(`${surface}: failed preparation after ${transition} ${persistent ? "retains only in the originating persistent queue" : "never requeues with persistence off"}`, async () => {
        await withChat(fullScreen, async ({ state, context, streams, queues, renderSender }) => {
          context.sessionPagingEnabled = true;
          const preparation = deferred();
          const processAttachments = context.processAttachments;
          const originalFile = { id: 1, file: { name: "first.pdf", type: "application/pdf" } };
          const newFile = { id: 2, file: { name: "new.pdf", type: "application/pdf" } };
          context.fileUpload.resetFiles([originalFile]);
          context.processAttachments = async (...args) => {
            await preparation.promise;
            if (transition !== "different session") throw new Error("attachment unavailable");
            return processAttachments(...args);
          };
          const first = renderSender().handleSendMessage();
          await settle();
          const newSessionId = transition === "different session" ? "new-chat" : "active-chat";
          queues.selectSession(newSessionId);
          state.draft = "new draft";
          state.html = "<p>new <strong>draft</strong></p>";
          context.fileUpload.resetFiles([newFile]);
          const rejected = transition !== "different session" ? assert.rejects(first, /attachment unavailable/) : null;
          preparation.resolve();
          if (rejected) await rejected;
          else assert.equal(await first, false);
          await settle();
          assert.deepEqual(context.messageQueueRef.current, []);
          assert.deepEqual(state.queued, []);
          assert.equal(state.html, "<p>new <strong>draft</strong></p>");
          assert.deepEqual(context.fileUpload.fileItems, [newFile]);
          assert.deepEqual(state.payloads, []);
          if (persistent) {
            const retained = context.persistentQueue.get("active-chat");
            assert.equal(retained.length, 1);
            assert.equal(retained[0].content, "first");
            assert.deepEqual(retained[0].files, [originalFile]);
            if (newSessionId !== "active-chat") assert.deepEqual(context.persistentQueue.get(newSessionId), []);
          }
          if (transition !== "different session") return;
          context.processAttachments = processAttachments;
          const next = renderSender().handleSendMessage();
          await settle();
          assert.deepEqual(state.payloads.map(({ message, session_id }) => [message, session_id]), [["new draft", "new-chat"]]);
          streams[0].resolve();
          assert.equal(await next, true);
          await settle();
          queues.drainQueuedMessage();
          await settle();
          assert.deepEqual(state.payloads.map(({ message, session_id }) => [message, session_id]), [["new draft", "new-chat"]]);
          assert.deepEqual(context.messageQueueRef.current, []);
          if (persistent) {
            queues.selectSession("active-chat");
            renderSender();
            queues.drainQueuedMessage();
            await settle();
            assert.deepEqual(state.payloads.map(({ message, session_id }) => [message, session_id]), [
              ["new draft", "new-chat"], ["first", "active-chat"],
            ]);
            assert.equal(state.payloads[1].attachments[0].fileName, "first.pdf");
            streams[1].resolve();
            await settle();
            assert.deepEqual(context.persistentQueue.get("active-chat"), []);
          }
        }, persistent);
      });
    }
  }

  test(`${surface}: unavailable session restores the detached text-only draft and its formatting`, async () => {
    await withChat(fullScreen, async ({ state, context, renderSender }) => {
      const setup = deferred();
      state.html = "<p><strong>first</strong></p>";
      context.waitForChatSession = () => setup.promise;
      const first = renderSender().handleSendMessage();
      assert.equal(state.draft, "");
      assert.equal(state.html, "");
      setup.resolve(undefined);
      assert.equal(await first, false);
      assert.equal(state.draft, "first");
      assert.equal(state.html, "<p><strong>first</strong></p>");
      assert.deepEqual(state.errors, ["AI chat is still loading. Please try again."]);
      assert.deepEqual(state.payloads, []);
      assert.equal(context.sendInFlightRef.current, false);
    });
  });

  for (const nextDraft of [
    { text: "new unsent draft", html: "<p>new <strong>unsent</strong> draft</p>" },
    { text: "", html: '<p><img src="data:image/png;base64,new"></p>' },
  ]) {
    for (const preparationStage of ["session", "attachments"]) {
      test(`${surface}: failed ${preparationStage} preparation retains the original message before queued sends without overwriting a newer ${nextDraft.text ? "text" : "image-only"} draft`, async () => {
        await withChat(fullScreen, async ({ state, context, streams, queues, renderSender }) => {
          const preparation = deferred();
          const waitForChatSession = context.waitForChatSession;
          const processAttachments = context.processAttachments;
          const activeFile = { id: 1, file: { name: "first.pdf", type: "application/pdf" } };
          const draftFile = { id: 2, file: { name: "draft.pdf", type: "application/pdf" } };
          context.fileUpload.resetFiles([activeFile]);
          state.html = "<p><strong>first</strong></p>";
          if (preparationStage === "session") {
            context.waitForChatSession = () => preparation.promise;
          } else {
            context.processAttachments = async () => {
              await preparation.promise;
              throw new Error("attachment unavailable");
            };
          }
          const first = renderSender().handleSendMessage();
          assert.equal(state.draft, "");
          await settle();
          assert.equal(await renderSender().handleSendMessage("second", { filesForAttachments: [] }), true);
          state.draft = nextDraft.text;
          state.html = nextDraft.html;
          context.fileUpload.resetFiles([draftFile]);
          const rejected = preparationStage === "attachments"
            ? assert.rejects(first, /attachment unavailable/)
            : first;
          preparation.resolve();
          if (preparationStage === "attachments") await rejected;
          else assert.equal(await first, false);
          await settle();
          assert.equal(state.draft, nextDraft.text);
          assert.equal(state.html, nextDraft.html);
          assert.deepEqual(context.fileUpload.fileItems, [draftFile]);
          assert.deepEqual(state.queued.map(({ content, html, files }) => ({ content, html, files })), [
            { content: "first", html: "<p><strong>first</strong></p>", files: [activeFile] },
            { content: "second", html: "", files: [] },
          ]);
          assert.deepEqual(state.payloads, []);
          assert.equal(context.sendInFlightRef.current, false);

          const retained = [...state.queued];
          context.waitForChatSession = async () => undefined;
          renderSender();
          queues.drainQueuedMessage();
          await settle();
          assert.deepEqual(state.queued.map(({ content, html, files }) => ({ content, html, files })),
            retained.map(({ content, html, files }) => ({ content, html, files })));
          assert.equal(context.sendInFlightRef.current, false);
          assert.deepEqual(state.payloads, []);

          context.waitForChatSession = waitForChatSession;
          context.processAttachments = processAttachments;
          renderSender();
          queues.drainQueuedMessage();
          await settle();
          assert.deepEqual(state.payloads.map(({ message, session_id }) => [message, session_id]), [["first", "active-chat"]]);
          assert.deepEqual(state.processed, [{ html: "<p><strong>first</strong></p>", files: [activeFile] }]);
          streams[0].resolve();
          await settle();
          assert.deepEqual(state.payloads.map(({ message, session_id }) => [message, session_id]), [
            ["first", "active-chat"], ["second", "active-chat"],
          ]);
          streams[1].resolve();
          await settle();
          assert.deepEqual(state.queued, []);
          assert.equal(state.draft, nextDraft.text);
          assert.equal(state.html, nextDraft.html);
          assert.deepEqual(context.fileUpload.fileItems, [draftFile]);
        });
      });
    }
  }

  for (const withQueuedFile of [false, true]) {
    test(`${surface}: setup-time queue owns only its files (${withQueuedFile ? "attached" : "text only"})`, async () => {
      await withChat(fullScreen, async ({ state, context, streams, queues, renderSender }) => {
        const setup = deferred();
        const activeFile = { id: 1, file: { name: "first.pdf", type: "application/pdf" } };
        const queuedFile = { id: 2, file: { name: "second.png", type: "image/png" } };
        context.fileUpload.resetFiles([activeFile]);
        context.waitForChatSession = () => setup.promise;
        const first = renderSender().handleSendMessage();
        assert.equal(context.sendInFlightRef.current, true);
        assert.deepEqual(context.fileUpload.fileItems, []);
        assert.deepEqual(state.processed, []);
        state.draft = "second";
        state.html = "<p>second</p>";
        const queuedFiles = withQueuedFile ? [queuedFile] : [];
        context.fileUpload.resetFiles(queuedFiles);
        assert.equal(await renderSender().handleSendMessage(), true);
        assert.deepEqual(state.queued.map(({ content, files }) => ({ content, files })), [
          { content: "second", files: queuedFiles },
        ]);
        setup.resolve(await queues.ensureSessionForCurrentBoard());
        await settle();
        assert.deepEqual(state.processed, [{ html: "<p>first</p>", files: [activeFile] }]);
        assert.deepEqual(state.payloads[0].attachments.map(({ fileName }) => fileName), ["first.pdf"]);
        assert.deepEqual(state.messages[0].message.attachments.map(({ fileName }) => fileName), ["first.pdf"]);
        assert.deepEqual(state.payloads[0].pdfs64.map(({ fileName }) => fileName), ["first.pdf"]);
        assert.deepEqual(state.payloads[0].images64, []);
        const draftFile = { id: 3, file: { name: "draft.pdf", type: "application/pdf" } };
        state.draft = "unsent third";
        state.html = "<p>unsent third</p>";
        context.fileUpload.resetFiles([draftFile]);
        renderSender();
        streams[0].resolve();
        assert.equal(await first, true);
        await settle();
        assert.deepEqual(state.processed[1], { html: "<p>second</p>", files: queuedFiles });
        assert.deepEqual(state.payloads.map(({ message, session_id }) => [message, session_id]), [
          ["first", "active-chat"], ["second", "active-chat"],
        ]);
        assert.deepEqual(state.payloads[1].attachments.map(({ fileName }) => fileName), withQueuedFile ? ["second.png"] : []);
        assert.deepEqual(state.payloads[1].pdfs64, []);
        assert.deepEqual(state.payloads[1].images64.map(({ fileName }) => fileName), withQueuedFile ? ["second.png"] : []);
        assert.equal(state.draft, "unsent third");
        assert.deepEqual(context.fileUpload.fileItems, [draftFile]);
        streams[1].resolve();
        await settle();
        assert.deepEqual(state.queued, []);
        assert.deepEqual(state.created, []);
      });
    });
  }

  test(`${surface}: an active request does not clear files added to the next draft`, async () => {
    await withChat(fullScreen, async ({ state, context, streams, renderSender }) => {
      const response = deferred();
      const fetchFixture = global.fetch;
      global.fetch = async (...args) => {
        const result = await fetchFixture(...args);
        await response.promise;
        return result;
      };
      const activeFile = { id: 1, file: { name: "first.pdf", type: "application/pdf" } };
      const draftFile = { id: 2, file: { name: "draft.pdf", type: "application/pdf" } };
      context.fileUpload.resetFiles([activeFile]);
      const first = renderSender().handleSendMessage();
      await settle();
      assert.equal(state.payloads.length, 1);
      context.fileUpload.resetFiles([draftFile]);
      response.resolve();
      await settle();
      assert.deepEqual(context.fileUpload.fileItems, [draftFile]);
      assert.deepEqual(state.payloads[0].attachments.map(({ fileName }) => fileName), ["first.pdf"]);
      streams[0].resolve();
      assert.equal(await first, true);
      assert.deepEqual(context.fileUpload.fileItems, [draftFile]);
    });
  });

  test(`${surface}: failed attachment preparation restores its files without losing newly added files`, async () => {
    await withChat(fullScreen, async ({ state, context, renderSender }) => {
      const preparation = deferred();
      const activeFile = { id: 1, file: { name: "first.pdf", type: "application/pdf" } };
      const draftFile = { id: 2, file: { name: "draft.pdf", type: "application/pdf" } };
      context.fileUpload.resetFiles([activeFile]);
      context.processAttachments = async (html, files) => {
        state.processed.push({ html, files });
        await preparation.promise;
        throw new Error("attachment unavailable");
      };
      const first = renderSender().handleSendMessage();
      await settle();
      assert.deepEqual(state.processed, [{ html: "<p>first</p>", files: [activeFile] }]);
      assert.deepEqual(context.fileUpload.fileItems, []);
      assert.equal(state.draft, "");
      assert.equal(state.html, "");
      context.fileUpload.resetFiles([draftFile]);
      const rejected = assert.rejects(first, /attachment unavailable/);
      preparation.resolve();
      await rejected;
      assert.deepEqual(context.fileUpload.fileItems, [activeFile, draftFile]);
      assert.equal(state.draft, "first");
      assert.equal(state.html, "<p>first</p>");
      assert.deepEqual(state.payloads, []);
      assert.equal(context.sendInFlightRef.current, false);
    });
  });

  test(`${surface}: an idle explicit-text send still starts immediately in the selected session`, async () => {
    await withChat(fullScreen, async ({ state, streams, sender }) => {
      const sending = sender.handleSendMessage("idle follow-up");
      await settle();
      assert.deepEqual(state.payloads.map((item) => [item.message, item.session_id]), [["idle follow-up", "active-chat"]]);
      assert.equal(state.messages[0].message.content, "idle follow-up");
      assert.equal(state.messages[0].message.sessionId, "active-chat");
      streams[0].resolve();
      assert.equal(await sending, true);
      assert.deepEqual(state.queued, []);
    });
  });
}

test("a busy search handoff still refuses without consuming its draft or attaching it to another send", async () => {
  await withChat(true, async ({ state, context, streams, sender }) => {
    const first = sender.handleSendMessage();
    await settle();
    state.draft = "keep my draft";
    assert.equal(await sender.handleSendMessage("search question", { preserveComposer: true }), false);
    assert.equal(state.draft, "keep my draft");
    assert.deepEqual(state.payloads.map((item) => item.message), ["first"]);
    assert.deepEqual(state.queued, []);
    streams[0].resolve();
    assert.equal(await first, true);
    assert.equal(context.sendInFlightRef.current, false);
  });
});
