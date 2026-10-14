import { useRef } from "react";
import type { Editor } from "@tiptap/react";
import { IComment } from "@/models/model";
import { useRecoilState } from "@/lib/state";
import {
  showAIChatInterfaceAtom,
  aiChatAutoOpenSuppressedAtom,
  aiChatExplicitOpenAtAtom,
} from "@/store";
import { useOptionalAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import { wrapBlockQuote } from "@/utils/helperFunctions/TaskDetail";

export function useCommentToAiChat() {
  const {
    editor,
    handleSendMessage,
    showAiChatInterface,
    isTyping,
    chatHistoryReady,
  } = useOptionalAiChatContext() ?? {};
  const [, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const [, setAiChatAutoOpenSuppressed] = useRecoilState(
    aiChatAutoOpenSuppressedAtom
  );
  const [, setAiChatExplicitOpenAt] = useRecoilState(aiChatExplicitOpenAtAtom);
  const sendingRef = useRef(false);
  const isTypingRef = useRef(isTyping);
  const chatHistoryReadyRef = useRef(chatHistoryReady);
  const handleSendMessageRef = useRef(handleSendMessage);
  isTypingRef.current = isTyping;
  chatHistoryReadyRef.current = chatHistoryReady;
  handleSendMessageRef.current = handleSendMessage;

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
    if (!showAiChatInterface) {
      setAiChatExplicitOpenAt(Date.now());
      setShowAiChatInterface(true);
    }
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
      await handleSendMessageRef.current?.();
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
      await handleSendMessageRef.current?.(
        "Summarize this ticket, its description and the key points from the comments, concisely."
      );
    } finally {
      sendingRef.current = false;
    }
  };

  return { copyCommentToAiChat, summarizeComment, summarizeTicket };
}
