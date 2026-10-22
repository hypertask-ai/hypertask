import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRecoilValue } from "@/lib/state"
import type { IProject } from "@/models/model"
import { aiChatEditTaskIdAtom, composeTaskChatIntroAtom, currentProjectAtom, inViewObjectAtom, taskDetailNonEssentialReadyAtom } from "@/store"
import { isGuestCookieUser } from "@/lib/demo/isGuestClient"
import { isGuestBoardBuild } from "@/lib/demo/guestBoardBuild"
import { GuestBoardSpotlight } from "./GuestBoardSpotlight"
import formatDateDifference from "@/utils/generateTime"
import { Sparkles } from "lucide-react"
import { taskSummaryActionFor } from "./taskSummaryAction"
import { useFlag } from "@/hooks/useFlag"
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG, HTPR_7337_EDIT_WITH_AI_FLAG, HTPR_7586_ONE_QUESTIONS_CALL_FLAG } from "@/lib/flags/keys"
import { useHydrated } from "@/hooks/General/useHydrated"

type TaskSessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

const TICKET_QUERIES = (ref: string) => [
  `Summarize ${ref}`,
  `Write my next reply on ${ref}`,
  `What's blocking ${ref}?`,
  `What are the next steps for ${ref}?`,
  `Draft a status update for ${ref}`,
  `Suggest sub-tasks for ${ref}`,
];

const EDIT_QUERIES = [
  "Rewrite in plain words",
  "Shorten the title",
  "Add acceptance criteria",
  "Split into sub-tasks",
  "Turn the error log into steps to reproduce",
];

const EDIT_PROMPTS = (ref: string) => [
  `Rewrite the description of ${ref} in plain words and update the ticket in place.`,
  `Shorten the title of ${ref} and update the ticket in place.`,
  `Add acceptance criteria to the description of ${ref} and update the ticket in place.`,
  `Split ${ref} into sub-tasks, create them under this ticket, and update its description in place with the breakdown.`,
  `Turn the error log in ${ref} into steps to reproduce and update the ticket description in place.`,
];

const SUGGESTED_QUERIES_POOL = [
  "What should I work on next?",
  "Summarize the last 3 days",
  "What's unassigned?",
  "What's blocking release?",
  "Draft a task for the next sprint",
  "What's overdue?",
  "Who's overloaded?",
  "What's been stuck over a week?",
  "Top 3 focus this week?",
];

const QUERIES_TO_SHOW = 4;

const DEMO_QUERIES = [
  "What should I work on first?",
  "Summarize this board in 3 bullets",
  "Break the biggest task into subtasks",
  "What looks blocked or at risk?",
];

const BOARD_BUILD_EXAMPLES = [
  "Launch a marketing campaign",
  "Build a SaaS MVP",
  "Plan a wedding in Italy",
];

function pickRandom<T>(arr: T[]): T | null {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
}

function countOverdue(tasks: { dueDate?: Date }[]): number {
  const now = Date.now();
  return tasks.filter(
    (task) => task.dueDate && new Date(task.dueDate).getTime() < now
  ).length;
}

function shuffleAndTake<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export const WelcomeScreen = () => {
  const { handleSendMessage, isDetailPage, selectSession, editor } =
    useAiChatContext();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const isDemo = (pathname?.startsWith("/demo") ?? false) || isGuestCookieUser();
  const isFullScreenChat = pathname?.startsWith("/chat") ?? false;
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const currentProject = useRecoilValue(currentProjectAtom) as IProject | null;
  const sections = currentProject?.sections ?? null;
  const taskId = isDetailPage ? inViewObject?.taskId : undefined;
  const editWithAiEnabled = useFlag(HTPR_7337_EDIT_WITH_AI_FLAG);
  const editTaskId = useRecoilValue(aiChatEditTaskIdAtom);
  let isEditMode = false;
  if (editWithAiEnabled) isEditMode = Boolean(taskId) && editTaskId === taskId;
  const taskSummaryAction = taskSummaryActionFor(taskId);
  const ticketRef = taskId
    ? inViewObject.taskTicketNumber || "this ticket"
    : null;
  const taskDetailNonEssentialReady = useRecoilValue(
    taskDetailNonEssentialReadyAtom
  );
  const taskDetailDataReady = !isDetailPage || taskDetailNonEssentialReady;
  const oneQuestionsCallEnabled = useFlag(HTPR_7586_ONE_QUESTIONS_CALL_FLAG);
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const ticketQuestionsEnabled = useFlag(HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG);
  const composeIntro = useRecoilValue(composeTaskChatIntroAtom);
  const hasPendingTicketQuestions = oneQuestionsCallEnabled && composeEnabled && ticketQuestionsEnabled &&
    composeIntro?.taskId === taskId && / from your note\. Want me to refine it\?/.test(composeIntro?.content ?? "");
  const taskQuestions = useQuery({
    queryKey: ["task-questions", taskId],
    queryFn: async (): Promise<{ questions: string[] }> => {
      const response = await fetch("/api/ai/task-questions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      if (!response.ok) {
        throw new Error("Failed to load task questions");
      }
      return response.json();
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: Boolean(taskId) && taskDetailDataReady && !isEditMode && !hasPendingTicketQuestions,
  });
  const taskSessions = useQuery({
    queryKey: ["task-sessions", taskId],
    queryFn: async (): Promise<TaskSessionSummary[]> => {
      const response = await fetch(
        `/api/ai-chat/task-sessions?taskId=${taskId}`,
        { credentials: "include" }
      );
      if (!response.ok) {
        throw new Error("Failed to load task chat sessions");
      }
      const data = (await response.json()) as {
        sessions: TaskSessionSummary[];
      };
      return data.sessions;
    },
    enabled: Boolean(taskId) && taskDetailDataReady,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const suggestions = useMemo(() => {
    if (!hydrated) return SUGGESTED_QUERIES_POOL.slice(0, QUERIES_TO_SHOW);

    if (isDemo) return DEMO_QUERIES;

    if (ticketRef) {
      return shuffleAndTake(TICKET_QUERIES(ticketRef), QUERIES_TO_SHOW);
    }

    if (isFullScreenChat) {
      return shuffleAndTake(SUGGESTED_QUERIES_POOL, QUERIES_TO_SHOW);
    }

    const activeSections = sections
      ?.filter((section) => !section.deleted)
      .map((section) => ({
        ...section,
        items: (section.items ?? []).filter(
          (task) => !task.status || task.status === "Normal"
        ),
      }));

    if (!activeSections?.length) {
      return shuffleAndTake(SUGGESTED_QUERIES_POOL, QUERIES_TO_SHOW);
    }

    const nonEmptySections = activeSections.filter(
      (section) => section.items.length > 0
    );
    const busiestSection = nonEmptySections.reduce<
      (typeof nonEmptySections)[number] | null
    >(
      (busiest, section) =>
        !busiest || section.items.length > busiest.items.length
          ? section
          : busiest,
      null
    );
    const otherSections = nonEmptySections.filter(
      (section) => section !== busiestSection
    );
    const sectionPool = otherSections.length ? otherSections : nonEmptySections;
    const staleSection = pickRandom(sectionPool);
    const tasks = activeSections.flatMap((section) => section.items);
    const unassignedCount = tasks.filter(
      (task) => !task.assignees?.length
    ).length;
    const overdueCount = countOverdue(tasks);
    const projectName = currentProject?.title || currentProject?.name;
    const pool = ["What's important in my inbox?"];

    if (busiestSection) {
      pool.push(
        `Prioritize the ${busiestSection.items.length} tickets in ${busiestSection.section_title}`
      );
    }
    if (staleSection) {
      pool.push(`Summarize the ${staleSection.section_title} column`);
    }
    if (unassignedCount > 0) {
      pool.push(`Who should take the ${unassignedCount} unassigned?`);
    }
    if (overdueCount > 0) {
      pool.push(`Triage the ${overdueCount} overdue tickets`);
    }
    if (projectName) {
      pool.push(`What changed on ${projectName} this week?`);
    }
    pool.push(
      "What's been stuck the longest?",
      "Top 3 focus this week?",
      "Any duplicate tickets here?"
    );

    return shuffleAndTake(pool, QUERIES_TO_SHOW);
  }, [
    hydrated,
    isDemo,
    ticketRef,
    isFullScreenChat,
    sections,
    currentProject?.title,
    currentProject?.name,
  ]);

  const [boardBuild, setBoardBuild] = useState(false);
  useEffect(() => {
    setBoardBuild(isGuestBoardBuild(currentProject));
  }, [currentProject]);

  if (taskId) {
    const generatedQuestions = taskQuestions.data?.questions?.filter(Boolean) ?? [];
    const displayedQuestions = isEditMode ? EDIT_QUERIES : generatedQuestions.length
      ? generatedQuestions
      : suggestions;
    const askAll = () => {
      handleSendMessage(
        `Answer each of these about this ticket:\n${generatedQuestions
          .map((question, index) => `${index + 1}. ${question}`)
          .join("\n")}`
      );
    };

    return (
      <div className="flex flex-grow text-white-black flex-col items-center justify-center h-full px-10 py-4">
        <div className="flex flex-col gap-2 w-full max-w-md">
          {isEditMode && <p className="px-2 text-meta">How do you want to edit this task?</p>}
          {!isEditMode && taskSummaryAction && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded border-thin border-hypertasks-ai-purple/70 bg-hypertasks-ai-purple/10 p-2 text-left text-xs text-white-black hover:bg-hypertasks-ai-purple/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hypertasks-ai-purple"
              onClick={() => handleSendMessage(taskSummaryAction.prompt)}
            >
              <Sparkles
                aria-hidden="true"
                className="shrink-0 text-hypertasks-ai-purple"
                size={14}
                strokeWidth={1.75}
              />
              <span>{taskSummaryAction.label}</span>
            </button>
          )}
          {displayedQuestions.map((suggestion, index) => (
            <button
              key={suggestion}
              className="bg-kanban-active-cardbg hover:bg-hover-active rounded p-2 text-xs text-left w-full"
              onClick={() => handleSendMessage(isEditMode ? EDIT_PROMPTS(ticketRef!)[index] : suggestion)}
            >
              {suggestion}
            </button>
          ))}
          {!isEditMode && generatedQuestions.length > 0 && !taskQuestions.isLoading && (
            <button
              className="self-start px-2 text-[11px] text-text-light-gray hover:text-white-black"
              onClick={askAll}
            >
              Ask all
            </button>
          )}
          {!isEditMode && taskSessions.data && taskSessions.data.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              <p className="px-2 text-[11px] text-text-light-gray">
                Previous threads
              </p>
              {taskSessions.data.map((session) => (
                <button
                  key={session.id}
                  className="flex w-full items-center gap-3 rounded p-2 text-left text-xs text-text-light-gray hover:bg-hover-active hover:text-white-black"
                  onClick={() => selectSession(session.id)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {session.title}
                  </span>
                  <span className="shrink-0 text-[11px]">
                    {formatDateDifference(session.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (boardBuild)
    return (
      <div className="flex flex-grow text-white-black flex-col items-center justify-center h-full px-10 py-4">
        <div className="flex flex-col gap-2 w-full max-w-md">
          <p className="px-2 text-meta">What are you working on?</p>
          <p className="px-2 mb-1 text-[11px] text-text-light-gray">
            Describe it in one sentence and I&apos;ll build your board.
          </p>
          {BOARD_BUILD_EXAMPLES.map((example) => (
            <button
              key={example}
              className="bg-kanban-active-cardbg hover:bg-hover-active rounded text-white-black p-2 text-meta text-left w-full"
              onClick={() => handleSendMessage(example)}
            >
              {example}
            </button>
          ))}
        </div>
        <GuestBoardSpotlight onReveal={() => editor?.commands.focus("end")} />
      </div>
    )

  return (
    <div className="flex flex-grow text-white-black flex-col items-center justify-center h-full px-10 py-4">
      <div className="flex flex-col gap-2 w-full max-w-md">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            className="bg-kanban-active-cardbg hover:bg-hover-active rounded text-white-black p-2 text-meta text-left w-full"
            onClick={() => handleSendMessage(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}
