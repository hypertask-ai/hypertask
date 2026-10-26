import { matchChatShortcut } from "@/lib/aiChat/chatShortcuts";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { SLASH_MENU_DOM_ID } from "@/lib/skills/slashSkills";
import { IChatMessage } from "@/models/model";
import { DIV_ID_CONSTANTS } from "@/lib/configs/general.config";
import type { useAiChatState } from "./useAiChatState";
import type { createAiChatSend } from "./aiChatSend";
import type { useAiChatSessions } from "./useAiChatSessions";
import type { useAiChatAttachments } from "./useAiChatAttachments";
import { MOBILE_VIEWPORT_MAX_PX } from "./aiChatShared";

type Context = { sharedShortcutsEnabled?: boolean } & Pick<ReturnType<typeof useAiChatState>, "setAiChatExplicitOpenAt" | "setIsSidebarMode" | "editor" | "setAiChatAutoOpenSuppressed" | "setAiChatPinned" | "setShowAIChat" | "setMinimized" | "setChatMounted" | "currentSession" | "showMentionList" | "isTyping" | "isFullScreenChat" | "showAiChatInterface" | "isSidebarMode" | "lastWorkspaceFocusRef" | "chatMounted"> &
  Pick<ReturnType<typeof createAiChatSend>, "handleSendMessage"> &
  Pick<ReturnType<typeof useAiChatSessions>, "isApple" | "isByokBlocked" | "fileUpload" | "startNewSession"> &
  Pick<ReturnType<typeof useAiChatAttachments>, "handleCancelStream">;

export function createAiChatKeyboard(context: Context) {
  const {
  setAiChatExplicitOpenAt, setIsSidebarMode, editor, setAiChatAutoOpenSuppressed, setAiChatPinned,
  setShowAIChat, setMinimized, setChatMounted, currentSession, handleSendMessage,
  isApple, showMentionList, isByokBlocked, isTyping, handleCancelStream,
  isFullScreenChat, showAiChatInterface, isSidebarMode, lastWorkspaceFocusRef, fileUpload,
  chatMounted, startNewSession, sharedShortcutsEnabled,
  } = context;


  const toggleSidebarMode = () => {
    setAiChatExplicitOpenAt(Date.now());
    setIsSidebarMode((prev) => !prev);
  };

  const togglePopover = () => {
    editor?.commands.blur();
    setAiChatAutoOpenSuppressed(true);
    setAiChatPinned(false);
    setShowAIChat(false);
    setMinimized(false);
    setChatMounted(false);
  };

  const minimizeChat = () => {
    editor?.commands.blur();
    setMinimized(true);
  };
  const restoreChat = () => {
    setAiChatExplicitOpenAt(Date.now());
    setMinimized(false);
  };

  function retryStream(message?: IChatMessage) {
    const targetMsg =
      message ??
      [...(currentSession?.messages ?? [])].reverse().find((msg) => msg.role === "human");
    if (!targetMsg?.content) return;
    handleSendMessage(targetMsg.content);
  }

  function editMessage(message: IChatMessage) {
    if (!message.content) return;
    editor?.commands.setContent(message.content);
    editor?.commands.focus("end");
  }

  function tiptapKeydown(e: any) {
    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (e.defaultPrevented || e.isComposing || e.nativeEvent?.isComposing) return;
    const sendShortcut = sharedShortcutsEnabled
      ? matchChatShortcut(e, true) === "send"
      : e.keyCode === KeyCodes.ENTER && !e.shiftKey;
    if (sendShortcut) {
      const mentionListElement = document.getElementById(
        DIV_ID_CONSTANTS.aiMentionList
      );
      if (showMentionList || editor?.isEmpty) {
        return;
      }
      if (document.getElementById(SLASH_MENU_DOM_ID)) {
        return;
      }
      e.preventDefault();
      if (isByokBlocked) return;
      handleSendMessage();
    }
    if (e.keyCode === KeyCodes.ESCAPE && isTyping) {
      e.preventDefault();
      handleCancelStream();
    }
    if (
      e.keyCode === KeyCodes.Q &&
      e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      !e.repeat
    ) {
      e.preventDefault();
      if (
        !isFullScreenChat &&
        showAiChatInterface &&
        isSidebarMode &&
        window.innerWidth >= MOBILE_VIEWPORT_MAX_PX
      ) {
        const workspace = document.querySelector<HTMLElement>(
          "[data-ai-workspace]"
        );
        const previousWorkspaceTarget = lastWorkspaceFocusRef.current;
        if (
          previousWorkspaceTarget?.isConnected &&
          workspace?.contains(previousWorkspaceTarget)
        ) {
          previousWorkspaceTarget.focus({ preventScroll: true });
        } else {
          workspace?.focus({ preventScroll: true });
        }
        e.stopPropagation();
        return;
      }
      editor?.commands.focus("end");
    }
    if (e.keyCode === KeyCodes.U && cmdControl) {
      e.preventDefault();
      fileUpload.handleAttachmentClick();
    }
    if (e.keyCode === KeyCodes.D && cmdControl && e.shiftKey) {
      const anchor = editor?.view.dom.closest("[data-ai-chat-composer-root]")?.querySelector<HTMLElement>("[data-ai-chat-recorder]");
      if (anchor) {
        e.preventDefault();
        anchor.click();
      }
    }
  }

  function layoutKeydown(e: any) {
    if (e.defaultPrevented || e.isComposing) return;
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

    if (e.keyCode === KeyCodes.FORWARD_SLASH && cmdControl && e.shiftKey) {
      e.preventDefault();
      if (!chatMounted) return setChatMounted(true);
      setTimeout(() => {
        togglePopover();
      }, 10);
    }

    if (
      e.keyCode === KeyCodes.Q &&
      e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      !e.repeat
    ) {
      e.preventDefault();

      if (
        !isFullScreenChat &&
        showAiChatInterface &&
        isSidebarMode &&
        window.innerWidth >= MOBILE_VIEWPORT_MAX_PX
      ) {
        const activeElement = document.activeElement;
        const chatPanel = document.querySelector<HTMLElement>(
          "[data-ai-chat-panel]"
        );
        const workspace = document.querySelector<HTMLElement>(
          "[data-ai-workspace]"
        );

        if (
          activeElement instanceof HTMLElement &&
          chatPanel?.contains(activeElement)
        ) {
          const previousWorkspaceTarget = lastWorkspaceFocusRef.current;
          if (
            previousWorkspaceTarget?.isConnected &&
            workspace?.contains(previousWorkspaceTarget)
          ) {
            previousWorkspaceTarget.focus({ preventScroll: true });
          } else {
            workspace?.focus({ preventScroll: true });
          }
          return;
        }

        if (
          activeElement instanceof HTMLElement &&
          workspace?.contains(activeElement)
        ) {
          lastWorkspaceFocusRef.current = activeElement;
        }
        editor?.commands.focus("end");
        return;
      }

      if (!isFullScreenChat && !showAiChatInterface) {
        if (!chatMounted) setChatMounted(true);
        setAiChatExplicitOpenAt(Date.now());
        setShowAIChat(true);
        setAiChatAutoOpenSuppressed(false);
        setTimeout(() => {
          editor?.commands.focus("end");
        }, 10);
        return;
      }
      editor?.commands.focus("end");
      return;
    }

    if (
      (e.keyCode === KeyCodes.O || e.keyCode === KeyCodes.J) &&
      e.shiftKey &&
      cmdControl
    ) {
      e.preventDefault();
      if (showAiChatInterface) {
        startNewSession();
        setTimeout(() => { try { editor?.view.dom.focus(); } catch {} }, 0);
        return;
      }
    }
  }
  return {
  toggleSidebarMode, togglePopover, minimizeChat, restoreChat, retryStream,
  editMessage, tiptapKeydown, layoutKeydown,
  };
}
