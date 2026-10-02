import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { SLASH_MENU_DOM_ID } from "@/lib/skills/slashSkills";
import { IChatMessage } from "@/models/model";
import { DIV_ID_CONSTANTS } from "@/lib/configs/general.config";
import type { useAiChatState } from "./useAiChatState";
import type { createAiChatSend } from "./aiChatSend";
import type { useAiChatSessions } from "./useAiChatSessions";
import type { useAiChatAttachments } from "./useAiChatAttachments";
import { MOBILE_VIEWPORT_MAX_PX } from "./aiChatShared";

type Context = Pick<ReturnType<typeof useAiChatState>, "setAiChatExplicitOpenAt" | "setIsSidebarMode" | "editor" | "setAiChatAutoOpenSuppressed" | "setAiChatPinned" | "setShowAIChat" | "setMinimized" | "setChatMounted" | "currentSession" | "showMentionList" | "isTyping" | "isFullScreenChat" | "showAiChatInterface" | "isSidebarMode" | "lastWorkspaceFocusRef" | "chatMounted"> &
  Pick<ReturnType<typeof createAiChatSend>, "handleSendMessage"> &
  Pick<ReturnType<typeof useAiChatSessions>, "isApple" | "isByokBlocked" | "fileUpload" | "startNewSession"> &
  Pick<ReturnType<typeof useAiChatAttachments>, "handleCancelStream">;

export function createAiChatKeyboard(context: Context) {
  const {
  setAiChatExplicitOpenAt, setIsSidebarMode, editor, setAiChatAutoOpenSuppressed, setAiChatPinned,
  setShowAIChat, setMinimized, setChatMounted, currentSession, handleSendMessage,
  isApple, showMentionList, isByokBlocked, isTyping, handleCancelStream,
  isFullScreenChat, showAiChatInterface, isSidebarMode, lastWorkspaceFocusRef, fileUpload,
  chatMounted, startNewSession,
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

  // Collapse the floating window to a bottom tab (chat stays mounted) and
  // reopen it, distinct from togglePopover which closes the chat entirely.
  const minimizeChat = () => {
    editor?.commands.blur();
    setMinimized(true);
  };
  const restoreChat = () => {
    setAiChatExplicitOpenAt(Date.now());
    setMinimized(false);
  };

  // If message is provided, use it; otherwise, find latest human message
  function retryStream(message?: IChatMessage) {
    const targetMsg =
      message ??
      [...(currentSession?.messages ?? [])].reverse().find((msg) => msg.role === "human");
    if (!targetMsg?.content) return;
    handleSendMessage(targetMsg.content);
  }

  // Load a sent message back into the composer so the user can rephrase and
  // resend it. Ambiguous phrasing is the main way the agent misreads a request,
  // and retry alone can only repeat the same words. (HTPR-4218)
  function editMessage(message: IChatMessage) {
    if (!message.content) return;
    editor?.commands.setContent(message.content);
    editor?.commands.focus("end");
  }

  function tiptapKeydown(e: any) {
    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (e.keyCode === KeyCodes.ENTER && !e.shiftKey) {
      // Don't process message if mention list is visible - let mention list handle Enter
      // Check both the state and DOM element as fallback
      const mentionListElement = document.getElementById(
        DIV_ID_CONSTANTS.aiMentionList
      );
      if (showMentionList || editor?.isEmpty) {
        return; // Let the mention list handle the Enter key
      }
      // The "/" skills menu (SlashCommands) is open: let its Enter handler pick
      // the skill instead of sending. The popup's DOM marker is the reliable
      // signal — NOT e.defaultPrevented, because ProseMirror always
      // preventDefaults Enter (its newline handling) before this bubbled handler
      // runs, so a defaultPrevented check would block every send.
      if (document.getElementById(SLASH_MENU_DOM_ID)) {
        return;
      }
      e.preventDefault();
      if (isByokBlocked) return;
      // While streaming, Enter queues (HTPR-5695) instead of being ignored.
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
        // React delegates this handler below document. Stop this same keydown
        // from reaching the global handler after focus has moved, or it would
        // immediately interpret the workspace as the source and bounce back.
        e.stopPropagation();
        return;
      }
      editor?.commands.focus("end");
    }
    if (e.keyCode === KeyCodes.U && cmdControl) {
      e.preventDefault();
      fileUpload.handleAttachmentClick();
    }
    // [cmd/ctrl]+[shift]+[d] → speech to text. The shortcut is advertised in the
    // cheatsheet and works in the comment composer, but nothing bound it here, so
    // in chat Chrome just took it (bookmark-all-tabs). Click the mic's anchor by
    // id, the same way the comment composer does, rather than lifting the
    // recorder's internals into this hook (HTPR-5086).
    if (e.keyCode === KeyCodes.D && cmdControl && e.shiftKey) {
      const anchor = document.getElementById("ai-chat-audio-button");
      if (anchor) {
        e.preventDefault();
        anchor.click();
      }
    }
  }

  function layoutKeydown(e: any) {
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

    //Open AI Chat Interface
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

      // In the desktop sidebar layout, Control+Q is a two-way focus switch. It
      // keeps the chat visible and restores the precise workspace target when
      // possible. Full-screen/mobile chat retain the existing focus behavior.
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

    //Start new Session shortcut handling
    if (
      (e.keyCode === KeyCodes.O || e.keyCode === KeyCodes.J) &&
      e.shiftKey &&
      cmdControl
    ) {
      e.preventDefault();
      if (showAiChatInterface) {
        startNewSession();
        // Land the cursor in the fresh composer. Plain DOM focus on the
        // mounted contenteditable — the Tiptap command path can silently
        // no-op here (HTPR-4565).
        setTimeout(() => { try { editor?.view.dom.focus(); } catch { /* view unmounted */ } }, 0);
        return;
      }
    }
  }
  return {
  toggleSidebarMode, togglePopover, minimizeChat, restoreChat, retryStream,
  editMessage, tiptapKeydown, layoutKeydown,
  };
}
