import { useEffect, useLayoutEffect, useRef } from "react";
import { signalAiChip } from "@/lib/ai/chipEvents";
import { MessageItem } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { useQuery } from "@tanstack/react-query";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { composeTaskOriginalNoteAtom, composeTaskQuestionsTaskIdAtom, composeTaskSkillFollowupAtom, inViewObjectAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG, HTPR_7601_ONLY_VIEWED_TICKET_QUESTIONS_FLAG, HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG, HTPR_7978_AI_CHIP_EVENTS_FLAG, HTPR_7979_ACTION_CHIPS_FLAG } from "@/lib/flags/keys";

interface MessageListProps { sidebarKey?: string; active?: boolean; hidden?: boolean }

const composeIntroIdPattern = /^compose-task-(\d+)$/;

const isSavedOrLocalComposeIntro = (content: string) => / from your note\. Want me to refine it\?/.test(content);

export const MessageList: React.FC<MessageListProps> = ({ sidebarKey, active = true, hidden = false }) => {
  const scrollPositions = useRef(new Map<string, { top: number; away: boolean }>());
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const {
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
  const scrollKey = sidebarKey ?? currentSession?.id ?? "";
  const messages = currentSession?.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const ticketQuestionsEnabled = useFlag(HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG);
  const actionChipsEnabled = useFlag(HTPR_7979_ACTION_CHIPS_FLAG);
  const introTaskId = Number(composeIntroIdPattern.exec(lastMessage?.id ?? "")?.[1]);
  let newTicketId = currentSession?.taskId;
  if (actionChipsEnabled && !newTicketId && Number.isInteger(introTaskId)) newTicketId = introTaskId;
  const lastMessageIsIntro = actionChipsEnabled && Number.isInteger(introTaskId);
  const onlyViewedTicket = useFlag(HTPR_7601_ONLY_VIEWED_TICKET_QUESTIONS_FLAG);
  const viewedTaskId = useRecoilValue(inViewObjectAtom)?.taskId;
  const sessionIsAnotherTicket = onlyViewedTicket && Boolean(viewedTaskId) && viewedTaskId !== newTicketId;
  const skillFollowupEnabled = useFlag(HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG);
  const chipEventsEnabled = useFlag(HTPR_7978_AI_CHIP_EVENTS_FLAG);
  const originalNoteState = useRecoilValue(composeTaskOriginalNoteAtom);
  let chipSignal: typeof signalAiChip | undefined;
  if (chipEventsEnabled) chipSignal = signalAiChip;
  const pendingFollowupState = useRecoilValue(composeTaskSkillFollowupAtom);
  let pendingFollowup: typeof pendingFollowupState = null;
  if (skillFollowupEnabled) pendingFollowup = pendingFollowupState;
  const waitingForSkillFollowup = Boolean(pendingFollowup) &&
    pendingFollowup?.taskId === (viewedTaskId ?? newTicketId);
  const showTicketQuestions = !waitingForSkillFollowup && ticketQuestionsEnabled && Boolean(newTicketId) && !sessionIsAnotherTicket && (messages.length === 1 || lastMessageIsIntro) &&
    lastMessage?.role === "assistant" && isSavedOrLocalComposeIntro(lastMessage.content ?? "");
  let originalNote: string | undefined;
  if (actionChipsEnabled && originalNoteState?.taskId === newTicketId) originalNote = originalNoteState?.note;
  const ticketQuestions = useQuery({
    queryKey: ["task-questions", "new-ticket", newTicketId],
    queryFn: async (): Promise<{ questions: string[]; chipType?: "action-chip" }> => {
      const response = await fetch("/api/ai/task-questions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: newTicketId, kind: "new-ticket", ...(originalNote ? { originalNote } : {}) }),
      });
      if (!response.ok) throw new Error("Failed to load new ticket questions");
      const body: { questions: string[]; chipType?: "action-chip" } = await response.json();
      if (actionChipsEnabled) body.chipType = "action-chip";
      return body;
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
  const chipType = ticketQuestions.data?.chipType ?? "generated-question";
  const newTicketQuestionsKey = showTicketQuestions ? JSON.stringify(newTicketQuestions) : "";
  useEffect(() => {
    if (!chipSignal || !active || hidden || !showTicketQuestions || newTicketQuestions.length === 0) return;
    chipSignal({ kind: "shown", surface: "new-ticket-questions", chipType, chips: newTicketQuestions, taskId: newTicketId ?? null });
    return () => chipSignal({ kind: "dismiss", surface: "new-ticket-questions" });
  }, [chipSignal, active, hidden, showTicketQuestions, newTicketId, newTicketQuestionsKey, chipType]);

  useLayoutEffect(() => {
    registerMessageListRef(messageListRef.current);
    return () => registerMessageListRef(null);
  }, []);

  useLayoutEffect(() => {
    const element = messageListRef.current;
    const content = messagesContentRef.current;
    if (!active || hidden || !element || !content) return;

    const followMessages = () => {
      const saved = scrollPositions.current.get(scrollKey);
      if (saved?.away) element.scrollTop = saved.top;
      else scrollMessagesToBottom("auto");
      scrollPositions.current.set(scrollKey, { top: element.scrollTop, away: saved?.away ?? false });
      handleMessageListScroll(element);
    };
    followMessages();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(followMessages);
    observer.observe(content);
    observer.observe(element);
    return () => observer.disconnect();
  });


  return (
    <div
      ref={messageListRef}
      hidden={hidden}
      onScroll={(event) => {
        if (!active || hidden) return;
        const element = event.currentTarget;
        const saved = scrollPositions.current.get(scrollKey);
        const nearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 48;
        const movedUp = Boolean(saved && element.scrollTop < saved.top);
        scrollPositions.current.set(scrollKey, { top: element.scrollTop,
          away: !nearBottom && (movedUp || Boolean(saved?.away)) });
        handleMessageListScroll(element);
      }}
      className="flex-1 min-h-0 min-w-0 max-w-full overflow-x-hidden overflow-y-auto p-2 max-h-full scrollbar-thin hover:scrollbar-thumb-list-scroll-hover scrollbar-thumb-list-scroll scrollbar-track-kanban-column-scrollbar"
    >
      <div ref={messagesContentRef} className="space-y-2">
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
            {newTicketQuestions.map((question, index) => (
              <button
                key={question}
                data-compose-question
                className="bg-kanban-active-cardbg hover:bg-hover-active rounded p-2 text-meta text-left w-full"
                onClick={() => {
                  chipSignal?.({ kind: "clicked", text: question, index, chipType });
                  handleSendMessage(question);
                }}
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
        <div />
      </div>
    </div>
  );
};
