import { useEffect, useRef } from "react";
import { TAiModal } from "@/models/AI_Task_writer_model";
import { focusAiChatEditorForRequest, isEditableElement } from "@/utils/aiChat/focusRequestWindow";
import { IChatMessage } from "@/models/model";
import toast from "react-hot-toast";
import { readChatOpenForSession, writeChatOpenForSession } from "@/lib/aiChat/chatOpenSession";
import type { useAiChatState } from "./useAiChatState";
import type { useAiChatAttachments } from "./useAiChatAttachments";
import { MOBILE_VIEWPORT_MAX_PX } from "./aiChatShared";

type Context = Pick<ReturnType<typeof useAiChatState>, "setAiOption" | "contextList" | "setContextList" | "editor" | "streamingSessionRef" | "showAiChatInterface" | "aiChatExplicitOpenAt" | "setAiChatExplicitOpenAt" | "setChatMounted" | "hasAttemptedRestoreRef" | "currentUser" | "setShowAIChat" | "messageListRef" | "setShowScrollUpIndicator" | "toggleCreateTaskGlobally" | "inViewObject" | "setShowRenameChatModal" | "currentSession" | "updateSessionTitle"> &
  Pick<ReturnType<typeof useAiChatAttachments>, "handleCancelStream">;

export function useAiChatPresentation(context: Context) {
  const {
  setAiOption, contextList, setContextList, editor, handleCancelStream,
  streamingSessionRef, showAiChatInterface, aiChatExplicitOpenAt, setAiChatExplicitOpenAt, setChatMounted,
  hasAttemptedRestoreRef, currentUser, setShowAIChat, messageListRef, setShowScrollUpIndicator,
  toggleCreateTaskGlobally, inViewObject, setShowRenameChatModal, currentSession, updateSessionTitle,
  } = context;


  const dropDownButtonAICallback = (selectedAiModel: TAiModal) => {
    setAiOption(selectedAiModel);
  };

  function handleRemoveContext(index: number) {
    const updatedContext = contextList.filter((x: any, idx) => idx !== index);
    setContextList(updatedContext);
  }

  function handleAddContext() {
    editor?.commands.focus("end");
    editor?.commands.insertContent(editor?.isEmpty ? "@" : " @");
  }

  // Latest values for the unmount handler below. They are read through refs
  // rather than closed over, because an effect that depends on them re-runs whenever
  // they change, and a cleanup that cancels the stream must not run on a re-render.
  const cancelContextRef = useRef({
    handleCancelStream,
  });
  // Written in an effect, not during render: a render can be thrown away, and a ref
  // assigned mid-render would then hold a value that never happened.
  useEffect(() => {
    cancelContextRef.current = {
      handleCancelStream,
    };
  });

  // Cancel an active stream only when the provider genuinely unmounts. A page
  // unload can be a mobile suspension/eviction; the server now finishes and
  // persists that reply even after the SSE client disconnects.
  //
  // This used to depend on [chatRoute, currentStreamingSession, token]. A cleanup runs
  // on every dependency change, not only on unmount, so the moment `token` resolved
  // (useMcpToken starts at null and fills in asynchronously) the cleanup fired and
  // cancelled the stream that was still running. Ctrl+K "Summarize ticket" hit this
  // constantly: it opens the chat and sends in the same breath, so the token almost
  // always landed mid-stream, the request was cancelled, and the summary never arrived.
  // Empty deps keep the cleanup to a real unmount; the refs above keep it current.
  useEffect(() => {
    return () => {
      if (streamingSessionRef.current) cancelContextRef.current.handleCancelStream();
    };
  }, []);

  // `editor` is in the deps because it now arrives asynchronously (HTPR-4508):
  // on the first open of a page load the chat is shown before the editor chunk
  // has loaded, so focusing only on the flag would leave the caret on the board
  // and send the user's next keystroke to the page-level shortcut handler.
  //
  // Gated on an explicit open for the same reason the composer's own retry loop
  // is (HTPR-6317): this is the call that actually claimed the caret at page
  // load, and the board owns c, j, k, Tab and / until someone asks for the chat.
  useEffect(() => {
    if (!showAiChatInterface) return;
    const active = document.activeElement as HTMLElement | null;
    const focused = focusAiChatEditorForRequest(editor, aiChatExplicitOpenAt, active);
    if (
      aiChatExplicitOpenAt !== null &&
      (focused || isEditableElement(active))
    ) {
      setAiChatExplicitOpenAt(null);
    }
  }, [
    showAiChatInterface,
    editor,
    aiChatExplicitOpenAt,
    setAiChatExplicitOpenAt,
  ]);

  useEffect(() => {
    setChatMounted(showAiChatInterface);
  }, [showAiChatInterface]);

  // Reopen the chat after a page reload (HTPR-4687). Deliberately sessionStorage and not
  // the persisted atom store: #1935 removed localStorage persistence because relaunching
  // the app is the last-resort escape from a chat you cannot dismiss, and localStorage
  // dropped you straight back into it. sessionStorage dies with the tab, so the reload
  // case is restored and the escape hatch survives.
  //
  // Skipped on mobile, matching every other auto-open path (LandingPage, TaskDetailComp):
  // there the chat is a full-height sheet, and reload is the move a stuck user actually
  // makes, so restoring it there would weaken the escape hatch rather than preserve it.
  // The viewport is read directly instead of via MobileViewContext, which is still false
  // on this pass — the provider only sets it in a layout effect, so trusting it here would
  // reopen the sheet on a phone before the context caught up.
  // Skipped without a signed-in user so a logged-out tab does not reopen it over /login.
  useEffect(() => {
    if (hasAttemptedRestoreRef.current || !currentUser?.id) return;
    hasAttemptedRestoreRef.current = true;
    if (window.innerWidth < MOBILE_VIEWPORT_MAX_PX) return;
    if (readChatOpenForSession()) {
      setChatMounted(true);
      setShowAIChat(true);
    }
  }, [currentUser?.id]);

  // Gated on the restore having been attempted: this effect also runs on mount, where it
  // would otherwise stamp "0" over the stored "1" before a late-arriving currentUser let
  // the restore read it, silently killing the feature.
  useEffect(() => {
    if (!hasAttemptedRestoreRef.current) return;
    writeChatOpenForSession(showAiChatInterface);
  }, [showAiChatInterface]);

  const handleMessageListScroll = (element?: HTMLElement | null) => {
    const target = element ?? messageListRef.current;
    if (!target) {
      setShowScrollUpIndicator(false);
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = target;

    if (scrollTop + clientHeight >= scrollHeight - 4) {
      setShowScrollUpIndicator(false);
    } else {
      setShowScrollUpIndicator(true);
    }
  };

  const registerMessageListRef = (element: HTMLDivElement | null) => {
    messageListRef.current = element;
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = "smooth") => {
    const target = messageListRef.current;
    if (!target) return;
    target.scrollTo({
      top: target.scrollHeight,
      behavior,
    });
  };

  async function copyResponse(message: IChatMessage) {
    try {
      const html = message.content?.toString() ?? "";
      // message.content is HTML — derive a plain-text version so pasting into
      // plain-text targets works (an html-only ClipboardItem pastes nothing there)
      const div = document.createElement("div");
      div.innerHTML = html;
      const plain = div.innerText;

      if (
        navigator.clipboard &&
        typeof navigator.clipboard.write === "function"
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }

      if (message.role === "human") {
        toast.success(`Query copied to clipboard`);
      } else {
        toast.success(`Response copied to clipboard`);
      }
    } catch (err) {
      console.log("🚀 ~ MessageItem ~ err:", err);
      toast.error("Unable to copy response");
    }
  }

  function createTaskFromResponse(message: IChatMessage) {
    //we gonna preset the task description. I forgot how we could do this. need to check. Man i am terribly tired.
    const content = message.content;

    toggleCreateTaskGlobally({
      sectionId: inViewObject?.sectionId!,
      sectionTitle: inViewObject.sectionTitle ?? "",
      position: "top",
      prefilledDescription: `${content}`,
    });
  }

  const toggleRenameChatModal = () => setShowRenameChatModal((prev) => !prev);

  const renameChat = (newTitle: string) => {
    const sessionId = currentSession?.id;
    // No resolved session means there's nothing to rename (a transient
    // refetch gap, or the chat was deleted from under the open modal) -
    // surface it the same way delete does rather than renaming a session id
    // that may no longer exist.
    if (!sessionId) {
      toast.error("No chat selected yet. Please try again in a moment.");
      setShowRenameChatModal(false);
      return;
    }
    updateSessionTitle(sessionId, newTitle);
    setShowRenameChatModal(false);
  };
  return {
  dropDownButtonAICallback, handleRemoveContext, handleAddContext, handleMessageListScroll, registerMessageListRef,
  scrollMessagesToBottom, copyResponse, createTaskFromResponse, toggleRenameChatModal, renameChat,
  };
}
