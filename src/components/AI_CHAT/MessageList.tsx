import { useEffect, useLayoutEffect, useRef } from "react";
import { MessageItem } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { useQuery } from "@tanstack/react-query";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { composeTaskQuestionsTaskIdAtom, composeTaskSkillFollowupAtom, inViewObjectAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG, HTPR_7601_ONLY_VIEWED_TICKET_QUESTIONS_FLAG, HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG } from "@/lib/flags/keys";

interface MessageListProps { sidebarKey?: string; active?: boolean; hidden?: boolean }

const isSavedOrLocalComposeIntro = (content: string) => / from your note\. Want me to refine it\?/.test(content);

export const MessageList: React.FC<MessageListProps> = ({ sidebarKey, active = true, hidden = false }) => {
  const scrollPositions = useRef(new Map<string, { top: number; away: boolean }>());
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
    handleSendMessage,
  } = useAiChatContext();
  const messages = currentSession?.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const ticketQuestionsEnabled = useFlag(HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG);
  const newTicketId = currentSession?.taskId;
  const onlyViewedTicket = useFlag(HTPR_7601_ONLY_VIEWED_TICKET_QUESTIONS_FLAG);
  const viewedTaskId = useRecoilValue(inViewObjectAtom)?.taskId;
  const sessionIsAnotherTicket = onlyViewedTicket && Boolean(viewedTaskId) && viewedTaskId !== newTicketId;
  const skillFollowupEnabled = useFlag(HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG);
  const pendingFollowupState = useRecoilValue(composeTaskSkillFollowupAtom);
  const pendingFollowup = skillFollowupEnabled ? pendingFollowupState : null;
  const waitingForSkillFollowup = Boolean(pendingFollowup) &&
    pendingFollowup?.taskId === (viewedTaskId ?? newTicketId);
  const showTicketQuestions = !waitingForSkillFollowup && ticketQuestionsEnabled && Boolean(newTicketId) && !sessionIsAnotherTicket && messages.length === 1 &&
    lastMessage?.role === "assistant" && isSavedOrLocalComposeIntro(lastMessage.content ?? "");
  const ticketQuestions = useQuery({
    queryKey: ["task-questions", "new-ticket", newTicketId],
    queryFn: async (): Promise<{ questions: string[] }> => {
      const response = await fetch("/api/ai/task-questions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: newTicketId, kind: "new-ticket" }),
      });
      if (!response.ok) throw new Error("Failed to load new ticket questions");
      return response.json();
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: showTicketQuestions,
  });
  const questionsTaskId = useRecoilValue(composeTaskQuestionsTaskIdAtom);
  const setQuestionsTaskId = useSetRecoilState(composeTaskQuestionsTaskIdAtom);
  useEffect(() => {
    if (showTicketQuestions && newTicketId === questionsTaskId) setQuestionsTaskId(null);
  }, [showTicketQuestions, newTicketId, questionsTaskId, setQuestionsTaskId]);
  const newTicketQuestions = ticketQuestions.data?.questions?.filter(Boolean) ?? [];

  useLayoutEffect(() => {
    registerMessageListRef(messageListRef.current);
    return () => registerMessageListRef(null);
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    const saved = sidebarKey ? scrollPositions.current.get(sidebarKey) : undefined;
    if (saved?.away && messageListRef.current) messageListRef.current.scrollTop = saved.top;
    else scrollMessagesToBottom("auto");
    handleMessageListScroll(messageListRef.current);
  }, [currentSession?.messages, sidebarKey, active]);

  useLayoutEffect(() => {
    scrollMessagesToBottom("auto");
    handleMessageListScroll(messageListRef.current);
  }, [chatMounted]);


  return (
    <div
      ref={messageListRef}
      hidden={hidden}
      onScroll={(event) => {
        if (!active) return;
        const element = event.currentTarget;
        if (sidebarKey) scrollPositions.current.set(sidebarKey, { top: element.scrollTop,
          away: element.scrollTop + element.clientHeight < element.scrollHeight - 4 });
        handleMessageListScroll(element);
      }}
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
      {(waitingForSkillFollowup || (showTicketQuestions && ticketQuestions.isLoading)) && (
        <div className="flex justify-start px-2 py-1">
          <TypingIndicator />
        </div>
      )}
      {showTicketQuestions && newTicketQuestions.length > 0 && (
        <div className="flex flex-col gap-2 px-2">
          <p className="px-2 text-micro text-text-light-gray">Questions and ideas for this ticket</p>
          {newTicketQuestions.map((question) => (
            <button
              key={question}
              data-compose-question
              className="bg-kanban-active-cardbg hover:bg-hover-active rounded p-2 text-meta text-left w-full"
              onClick={() => handleSendMessage(question)}
            >
              {question}
            </button>
          ))}
        </div>
      )}
      {isTyping && lastMessage?.role !== "assistant" && (
        <div className="flex justify-start px-2 py-1">
          <TypingIndicator />
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};
