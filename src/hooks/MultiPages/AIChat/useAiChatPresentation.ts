import { useKeepAiChatClosed } from "@/hooks/General/useKeepAiChatClosed";
import { useEffect, useRef } from "react";
import { useRecoilValue } from "@/lib/state";
import { aiChatAutoOpenSuppressedAtom } from "@/store";
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
  const { keepAiChatClosed, ready: chatAutoOpenReady } = useKeepAiChatClosed();
  const aiChatAutoOpenSuppressed = useRecoilValue(aiChatAutoOpenSuppressedAtom);
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

  const cancelContextRef = useRef({
    handleCancelStream,
  });
  useEffect(() => {
    cancelContextRef.current = {
      handleCancelStream,
    };
  });

  useEffect(() => {
    return () => {
      if (streamingSessionRef.current) cancelContextRef.current.handleCancelStream();
    };
  }, []);

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

  useEffect(() => {
    if (!chatAutoOpenReady || hasAttemptedRestoreRef.current || !currentUser?.id) return;
    hasAttemptedRestoreRef.current = true;
    if (window.innerWidth < MOBILE_VIEWPORT_MAX_PX) return;
    if (!keepAiChatClosed && !aiChatAutoOpenSuppressed && readChatOpenForSession()) {
      setChatMounted(true);
      setShowAIChat(true);
    }
  }, [currentUser?.id, chatAutoOpenReady, keepAiChatClosed, aiChatAutoOpenSuppressed]);

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
