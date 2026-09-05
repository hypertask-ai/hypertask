import { useEffect, useLayoutEffect, useRef } from "react";
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
    currentSession,
    isTyping,
  } = useAiChatContext();
  const messages = currentSession?.messages ?? [];
  const lastMessage = messages[messages.length - 1];

  // Auto-scroll to bottom when messages change
  useLayoutEffect(() => {
    scrollMessagesToBottom("smooth");
    handleMessageListScroll(messageListRef.current);
  }, [currentSession?.messages]);

  useLayoutEffect(() => {
    scrollMessagesToBottom("auto");
    handleMessageListScroll(messageListRef.current);
  }, [chatMounted]);

  useEffect(() => {
    registerMessageListRef(messageListRef.current);
    return () => registerMessageListRef(null);
  }, []);

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
