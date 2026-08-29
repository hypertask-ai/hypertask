import { useRef } from "react";
import type { Editor } from "@tiptap/react";
import { IComment } from "@/models/model";
import { useRecoilState } from "@/lib/state";
import {
  showAIChatInterfaceAtom,
  aiChatAutoOpenSuppressedAtom,
} from "@/store";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { wrapBlockQuote } from "@/utils/helperFunctions/TaskDetail";

/**
 * Shared logic for piping a comment or the whole ticket into the AI chat, used
 * by the Ctrl+K comment/ticket commands and the mouse-hover "Summarize"
 * affordance.
 *
 * - copyCommentToAiChat: opens the chat and inserts the comment into the
 *   current input so the user can add their own question. Does not send.
 * - summarizeComment: opens the chat, drops the comment in with a summarize
 *   instruction, and sends it. The summary streams back into the chat.
 * - summarizeTicket: opens the chat and sends a summarize prompt. The chat
 *   already carries the ticket via default_context.task_id on detail pages, so
 *   the model reads the description + comments itself.
 */
export function useCommentToAiChat() {
  const {
    editor,
    handleSendMessage,
    showAiChatInterface,
    isTyping,
    chatHistoryReady,
  } = useAiChatContext();
  const [, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const [, setAiChatAutoOpenSuppressed] = useRecoilState(
    aiChatAutoOpenSuppressedAtom
  );
  // Synchronous re-entry lock: isTyping only flips true after an await inside
  // handleSendMessage, so a fast double-trigger could fire two sends in that
  // gap. This blocks re-entry until the send settles.
  const sendingRef = useRef(false);
  const isTypingRef = useRef(isTyping);
  const chatHistoryReadyRef = useRef(chatHistoryReady);
  const handleSendMessageRef = useRef(handleSendMessage);
  isTypingRef.current = isTyping;
  chatHistoryReadyRef.current = chatHistoryReady;
  handleSendMessageRef.current = handleSendMessage;

  // The chat editor is built lazily now (HTPR-4508), so it can still be null
  // at the moment one of these commands fires from the board or a ticket. These
  // paths used to bail out on `!editor`, which after the deferral meant the
  // command silently did nothing at all, not even opening the chat. Open first,
  // then wait for the editor to arrive before touching it.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const withEditor = async (fn: (e: Editor) => void, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (!editorRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (editorRef.current) fn(editorRef.current);
    return !!editorRef.current;
  };

  const openChat = () => {
    setAiChatAutoOpenSuppressed(false);
    if (!showAiChatInterface) setShowAiChatInterface(true);
  };

  const waitForSession = async (timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (!chatHistoryReadyRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return chatHistoryReadyRef.current;
  };

  const copyCommentToAiChat = (comment?: IComment) => {
    const creator = comment?.creator;
    if (!creator) return;
    openChat();
    void withEditor((e) => {
      e.commands.insertContent(
        wrapBlockQuote(comment.text, creator, true)
      );
      e.commands.focus();
    });
  };

  const summarizeComment = async (comment?: IComment) => {
    const creator = comment?.creator;
    if (!creator) return;
    if (sendingRef.current || isTypingRef.current) return;
    sendingRef.current = true;
    try {
      openChat();
      const [editorReady, sessionReady] = await Promise.all([
        withEditor((e) => {
          e.commands.setContent(
            wrapBlockQuote(comment.text, creator, true) +
              "<p>Summarize this comment concisely.</p>"
          );
          e.commands.focus();
        }),
        waitForSession(),
      ]);
      if (!editorReady || !sessionReady || isTypingRef.current) return;
      await handleSendMessageRef.current();
    } finally {
      sendingRef.current = false;
    }
  };

  const summarizeTicket = async () => {
    if (sendingRef.current || isTypingRef.current) return;
    sendingRef.current = true;
    try {
      openChat();
      if (!(await waitForSession())) return;
      if (isTypingRef.current) return;
      // The chat already scopes to this ticket via default_context.task_id on
      // detail pages, so we only send the instruction; the model reads the
      // description + comments itself and the user keeps chatting in-thread.
      await handleSendMessageRef.current(
        "Summarize this ticket, its description and the key points from the comments, concisely."
      );
    } finally {
      sendingRef.current = false;
    }
  };

  return { copyCommentToAiChat, summarizeComment, summarizeTicket };
}
