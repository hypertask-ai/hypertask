import { useLayoutEffect, useRef } from "react";
import { MessageItem } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";

interface MessageListProps {}

export const MessageList: React.FC<MessageListProps> = () => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const {
    chatMounted,
    handleMessageListScroll,
    registerMessageListRef,
    scrollMessagesToBottom,
    copyResponse,
    createTaskFromResponse,
    retryStream,
    editMessage,
    sessions,
    activeSession,
    isTyping,
  } = useAiChatContext();
  // Sessions are reordered to the front on select/write, so `sessions[0]` is
  // usually the current one, but a session can become active (e.g. the
  // per-task session-init effect) without being moved to the front yet.
  // Resolve by id so the message list never shows a different task's chat.
  const currentSession =
    sessions.find((session) => session.id === activeSession) ?? sessions[0];
  const messages = currentSession?.messages ?? [];
  const lastMessage = messages[messages.length - 1];

  // Hand the scrollable node to the chat hook during the layout phase, and
  // before the auto-scroll effects below: scrollMessagesToBottom reads this
  // same node back out of the hook and returns early while it is still null.
  // Registering in a plain useEffect ran after those effects, so on the mount
  // that first paints a chat's history every auto-scroll silently did nothing
  // and the panel sat on the very first message with the "jump to bottom"
  // button showing. Hook order is declaration order, so this must stay above
  // them.
  useLayoutEffect(() => {
    registerMessageListRef(messageListRef.current);
    return () => registerMessageListRef(null);
  }, []);

  // Auto-scroll to bottom when messages change. "auto" (instant), not
  // "smooth": handleMessageListScroll below reads scrollTop synchronously
  // right after, and a smooth (animated) scroll hasn't moved yet at that
  // point, so it would misjudge distance-from-bottom and show the "jump to
  // bottom" button even though the view is about to land there anyway. This
  // is the same class of bug already fixed for the standalone agent chat
  // page in HTPR-6099 (AgentChatClient.tsx) - this docked chat panel
  // (ticket detail, Agents page) is a separate component that fix never
  // touched, which is why the reported bug kept reproducing here after it
  // shipped. The manual "jump to bottom" button keeps its smooth animation
  // (scrollMessagesToBottom's own default).
  useLayoutEffect(() => {
    scrollMessagesToBottom("auto");
    handleMessageListScroll(messageListRef.current);
  }, [currentSession?.messages]);

  useLayoutEffect(() => {
    scrollMessagesToBottom("auto");
    handleMessageListScroll(messageListRef.current);
  }, [chatMounted]);


  return (
    <div
      ref={messageListRef}
      onScroll={(event) => handleMessageListScroll(event.currentTarget)}
      className="flex-1 min-h-0 min-w-0 max-w-full overflow-x-hidden overflow-y-auto p-2 max-h-full space-y-2 scrollbar-thin  hover:scrollbar-thumb-gray-500  scrollbar-thumb-gray-500 scrollbar-track-kanban-column-scrollbar dark:scrollbar-thumb-[#4F5766]"
    >
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          copyResponse={copyResponse}
          createTaskFromResponse={createTaskFromResponse}
          retryStream={retryStream}
          editMessage={editMessage}
        />
      ))}
      {isTyping && lastMessage?.role !== "assistant" && (
        <div className="flex justify-start px-2 py-1">
          <TypingIndicator />
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};
