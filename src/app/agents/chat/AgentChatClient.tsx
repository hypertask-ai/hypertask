/* eslint-disable @next/next/no-img-element */
"use client";

import { AGENT_CHAT_EVENT } from "@/lib/realtime/shared";
import {
  AGENT_CHAT_COMMAND_EVENT,
  type TAgentChatCommand,
} from "@/lib/agents/chatPaletteCommands";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useRecoilValue } from "@/lib/state";
import { appShellRailAtom, agentChatTeamCycleAtom } from "@/store";
import { IUser, IProject, ITask } from "@/models/model";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { cn } from "@/utils/undoActions/helperFuncs";
import toast from "react-hot-toast";
import {
  Activity as ActivityIcon,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  ExternalLink,
  Info,
  Lightbulb,
  Plus,
  X,
} from "lucide-react";
import { TypingIndicator } from "@/components/AI_CHAT/TypingIndicator";
import { markdownToHtml } from "@/utils/helperFunctions/markdownToHtml";
import {
  wrapTablesInMessageHtml,
  interceptMessageLinkClick,
} from "@/utils/helperFunctions/messageHtmlLinks";
import formatDateDifference from "@/utils/generateTime";
import { isWorking, statusOf, listTeams } from "@/lib/agents/registerView";
import {
  tokenizeMessageLinks,
  extractMessageLinks,
  type TProjectIdForPrefix,
} from "@/lib/agents/messageLinks";
import AgentSelect, { AgentOption } from "../AgentSelect";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { userChannel } from "@/lib/realtime/shared";
import AgentDetail from "../[agentId]/AgentDetail";
import type { TAgent } from "../AgentsRegister";
import AgentAvatar from "@/components/Agents/AgentAvatar";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import axios from "axios";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { useFlag } from "@/hooks/useFlag";
import { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG } from "@/lib/agentRuns/model";
import { useMobileVisualViewport } from "@/hooks/General/useMobileVisualViewport";
import { getLastBoardTeam, setLastBoardTeam } from "@/lib/lastBoardTeam";
import { AudioButton } from "@/components/RTE/Components/AudioButton";
import { appendTitleDictation } from "@/components/Modals/CreateTaskGloballyModal/titleDictation";
import { QueuedMessagesStrip } from "@/components/Common/QueuedMessagesStrip";
import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
} from "@/components/Common/CommonModalComponents";
import {
  displayAgentChatFeed,
  mergeAgentChatFeed,
  type AgentChatActivity,
  type AgentChatActivityGroup,
  type AgentChatFilter,
} from "@/lib/agents/chatActivityFeed";


// While we are waiting for an external agent to answer, the only way to see
// the reply arrive is to keep asking.
const AWAITING_POLL_MS = 4000;
// Realtime still refetches when the reply lands; the interval is only a
// fallback, so stop it after this long waiting on the same session.
const AWAITING_POLL_MAX_MS = 15 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 8000;
const DETAILS_COLLAPSED_KEY = "agentChat.detailsCollapsed";

type TChatMessage = {
  id: string;
  role: "human" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type TAgentChatSession = { id: string; agentId: string };

/** Header status line: a live lease names its ticket, anything else is idle. */
function chatStatusText(agent: TAgent): string {
  if (isWorking(agent) && agent.working) {
    return `Working on ${agent.working.ticket}`;
  }
  return "Idle";
}

/** Roster status dot: green on any proof of life within the last 24h. */
function rosterDotClass(agent: TAgent): string {
  return statusOf(agent) === "running" ? "bg-green-500" : "bg-gray-400";
}

// Typography for the rendered markdown (paragraphs, links, inline code, code
// blocks). Shadow-only wells, no borders, per house style.
const MARKDOWN_CLASS =
  "break-words [&_p]:my-2 [&_p]:leading-relaxed [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_a]:text-hypertasks-purple [&_a]:underline [&_a]:break-all " +
  "[&_code]:bg-hoverCardBackground [&_code]:rounded-[3px] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-meta " +
  "[&_pre]:bg-hoverCardBackground [&_pre]:rounded-[4px] [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0";

function MessageBubble({
  message,
  projectIdForPrefix,
}: {
  message: TChatMessage;
  projectIdForPrefix: TProjectIdForPrefix;
}) {
  const router = useRouter();
  const isHuman = message.role === "human";
  if (message.role === "system") {
    return (
      <p className="text-meta text-text-light-gray" role="status">
        {message.content}
      </p>
    );
  }
  const timestamp = (
    <div
      className={cn(
        "mt-0.5 text-[10px] text-text-light-gray opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 max-md:opacity-100",
        isHuman ? "text-right" : "text-left",
      )}
    >
      {formatDateDifference(new Date(message.createdAt))}
    </div>
  );
  if (isHuman) {
    return (
      <div className="group/msg flex flex-col items-end">
        <div className="max-w-[80%] rounded-[4px] bg-shadcn-primary px-3 py-2 text-dense text-primary-foreground whitespace-pre-wrap break-words">
          {tokenizeMessageLinks(message.content, projectIdForPrefix).map(
            (segment, i) =>
              segment.type === "link" ? (
                <a
                  key={i}
                  href={segment.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {segment.value}
                </a>
              ) : (
                <span key={i}>{segment.value}</span>
              ),
          )}
        </div>
        {timestamp}
      </div>
    );
  }
  // markdownToHtml escapes raw HTML and sanitizes the result, so the string is
  // safe to inject.
  return (
    <div className="group/msg flex flex-col items-start">
      <div
        className={cn(
          "max-w-[80%] rounded-[4px] bg-cardBackground px-3 py-2 text-dense",
          MARKDOWN_CLASS,
        )}
        onClick={(e) => interceptMessageLinkClick(e, router)}
        dangerouslySetInnerHTML={{
          __html: wrapTablesInMessageHtml(markdownToHtml(message.content)),
        }}
      />
      {timestamp}
    </div>
  );
}

const ACTIVITY_ICONS: Record<
  AgentChatActivity["type"],
  typeof ActivityIcon
> = {
  thought: Lightbulb,
  action: ActivityIcon,
  error: CircleAlert,
  elicitation: CircleHelp,
};

function emptyFeedText(filter: AgentChatFilter, agentName: string): string {
  if (filter === "activity") return "No activity yet.";
  if (filter === "chat") return "No chat messages yet.";
  return `Send ${agentName} a message to start the conversation.`;
}

function ActivityGroup({ group }: { group: AgentChatActivityGroup }) {
  const label = group.task
    ? `${group.task.ticketNumber}: ${group.task.title}`
    : "Agent activity";
  return (
    <div
      className="rounded-[5px] bg-cardBackground px-3 py-2 text-meta text-text-light-gray"
      role="group"
      aria-label={label}
    >
      <div className="mb-1 flex min-w-0 items-center gap-1.5 font-medium">
        <ActivityIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        {group.task ? (
          <a
            href={group.task.url}
            className="min-w-0 truncate text-white-black hover:text-hypertasks-purple"
            title={label}
          >
            {group.task.ticketNumber} · {group.task.title}
          </a>
        ) : (
          <span className="text-white-black">Agent activity</span>
        )}
      </div>
      <div className="space-y-1">
        {group.events.map((event) => {
          const Icon = ACTIVITY_ICONS[event.type];
          const eventContent = event.link ? (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 text-white-black hover:text-hypertasks-purple"
            >
              <span className="truncate">{event.text}</span>
              <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            </a>
          ) : (
            <span className="min-w-0 truncate">{event.text}</span>
          );
          return (
            <div key={event.id} className="flex min-w-0 items-center gap-1.5">
              <Icon
                className={cn(
                  "h-3 w-3 shrink-0",
                  event.type === "error" && "text-red-500",
                )}
                strokeWidth={1.75}
                aria-hidden
              />
              {eventContent}
              <time
                dateTime={event.createdAt}
                className="ml-auto shrink-0 text-micro"
                title={new Date(event.createdAt).toLocaleString()}
              >
                {formatDateDifference(new Date(event.createdAt))}
              </time>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FeedFilter({
  value,
  onChange,
}: {
  value: AgentChatFilter;
  onChange: (value: AgentChatFilter) => void;
}) {
  const options: { value: AgentChatFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "chat", label: "Chat only" },
    { value: "activity", label: "Activity only" },
  ];
  return (
    <div
      className="flex w-fit rounded-[4px] bg-hoverCardBackground p-0.5"
      role="group"
      aria-label="Filter Agent Chat feed"
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-sm px-2 py-1 text-meta transition-colors",
              active
                ? "bg-cardBackground text-white-black shadow-sm"
                : "text-text-light-gray hover:text-white-black",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function QueuedMessageBubble({
  item,
  onCancel,
}: {
  item: { id: string; content: string };
  onCancel: (id: string) => void;
}) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[80%] rounded-[4px] bg-shadcn-primary px-3 py-2 text-dense text-primary-foreground whitespace-pre-wrap break-words opacity-70">
        {item.content}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-light-gray">
        <span className="font-semibold uppercase tracking-wide">Queued</span>
        <button
          type="button"
          onClick={() => onCancel(item.id)}
          className="hover:text-white-black"
          aria-label="Cancel queued message"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ScrollToBottomButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to latest messages"
      className="absolute left-1/2 top-2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-active-elementBg shadow-md"
    >
      <ChevronDown size={18} strokeWidth={1.75} />
    </button>
  );
}

function RosterRow({
  agent,
  selected,
  onSelect,
}: {
  agent: TAgent;
  selected: boolean;
  onSelect: (agent: TAgent) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(agent)}
      aria-pressed={selected}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 rounded-[4px] text-left transition-colors",
        selected ? "bg-hoverCardBackground" : "hover:bg-hoverCardBackground",
      )}
    >
      <AgentAvatar agentId={agent.id} name={agent.displayName} photoURL={agent.photoURL} size={28} className="text-[11px]" />
      <span
        className={cn("w-2 h-2 rounded-full shrink-0", rosterDotClass(agent))}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-dense font-medium truncate">
          {agent.displayName}
        </span>
        <span className="block text-[11px] text-text-light-gray truncate">
          {agent.runtimeType === "EXTERNAL" ? "External" : "Native"}
          {isWorking(agent) && agent.working ? ` · ${agent.working.ticket}` : ""}
        </span>
      </span>
    </button>
  );
}

interface IProp {
  currentUser: IUser;
}

// Stable reference so the "@" mention effect below does not see a new
// array (and re-fire) on every render while projects are still loading.
const EMPTY_PROJECTS: IProject[] = [];

const AgentChatClient = (props: IProp) => {
  const { currentUser } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMbl = useContext(MobileViewContext);
  const mobileAgentChatViewportEnabled = useFlag(
    "htpr-6129-mobile-agent-chat-viewport",
  );
  const activityRowsEnabled = useFlag("htpr-6094-agent-activity-rows");
  const chatStopAndTimeoutEnabled = useFlag(AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG);
  const mobileAgentChatViewport = useMobileVisualViewport(
    isMbl && mobileAgentChatViewportEnabled,
  );
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;

  const [agents, setAgents] = useState<TAgent[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<TAgentChatSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [messages, setMessages] = useState<TChatMessage[] | null>(null);
  const [activity, setActivity] = useState<AgentChatActivity[]>([]);
  const [feedFilter, setFeedFilter] = useState<AgentChatFilter>("all");
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Mic dictation (AudioButton), same component and editor={null} pattern as
  // the plain-text title field in TaskTitleModal.tsx.
  const [isRecording, setIsRecording] = useState(false);
  const [isDictationProcessing, setIsDictationProcessing] = useState(false);
  const [sending, setSending] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [stoppable, setStoppable] = useState(false);
  const [stopping, setStopping] = useState(false);
  // FIFO follow-ups typed while the agent is working (HTPR-6038), same
  // pattern as useAiChat.ts's messageQueueRef/drainQueuedMessage: the
  // composer never locks, a send while awaiting enqueues instead of
  // double-firing, and the oldest queued message auto-sends once the
  // agent's reply lands.
  const [queuedMessages, setQueuedMessages] = useState<
    { id: string; content: string }[]
  >([]);
  const messageQueueRef = useRef<{ id: string; content: string }[]>([]);
  // Set to a queued item's id when its drained send fails, so the item goes
  // back to the front of the queue instead of vanishing into the draft, and
  // draining stops until that same item is removed (the failure would
  // otherwise flip `awaiting` back to false and fire the next item out of
  // order).
  const blockedQueueIdRef = useRef<string | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState(false);
  // When the current wait for this session's reply began (last send, or first
  // noticed); the awaiting poll stops 15 minutes after it.
  const [awaitingSince, setAwaitingSince] = useState<{
    sessionId: string;
    at: number;
  } | null>(null);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [openingFullChat, setOpeningFullChat] = useState(false);
  // Auto-scroll + "scroll to bottom" indicator, same pattern as AI Chat's
  // MessageList.tsx / useAiChat.ts (handleMessageListScroll,
  // scrollMessagesToBottom), ported directly since both are a handful of
  // plain DOM-ref lines with no AI-chat-specific coupling.
  const messageListRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // "+" in the roster header: a minimal name-only create flow over the same
  // endpoint the admin API and CLI use, since no create-agent page exists yet.
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [createAgentError, setCreateAgentError] = useState<string | null>(null);
  // Shown once right after creation; the create endpoint never returns it again.
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  // "@" in the composer: a small task-search popover reusing the same
  // endpoint the Ctrl+K task search modal calls.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionResults, setMentionResults] = useState<ITask[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionOpen = mentionQuery !== null;

  // Refs mirror the state that async callbacks and event handlers must read
  // without going stale (which chat is on screen, which POST is in flight).
  const selectedIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  // Mirrors `awaiting` (computed below, after `messages` is known) for
  // drainQueuedMessage, a useRef-stable callback that can't otherwise read a
  // fresh value of a plain render-time const.
  const awaitingRef = useRef(false);
  // Mirrors `draft` for the global keydown handler below, so that handler
  // doesn't need `draft` in its dependency array (which would tear down and
  // re-add the window listener on every keystroke).
  const draftRef = useRef("");
  // Monotonic request generation for loadMessages, so a late response can be
  // recognized as superseded by a newer one for the same session.
  const loadGenRef = useRef(0);
  // Mobile keyboards only open for a focus() that lands synchronously inside
  // the tap's event handler, so selectAgent needs the composer's DOM node
  // before that handler returns (see the flushSync call there).
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Same pattern as loadGenRef: the mount-time roster fetch and the
  // post-create-agent refresh both call loadAgents/setAgents, so a slower
  // mount fetch resolving after a refresh must not clobber it.
  const rosterGenRef = useRef(0);

  const loadAgents = useCallback(async () => {
    const res = await fetch("/api/agents/owned");
    const data = (await res.json()) as {
      success?: boolean;
      agents?: TAgent[];
      error?: string;
    };
    if (!res.ok || !data.success || !Array.isArray(data.agents)) {
      throw new Error(data.error ?? "Failed to load agents");
    }
    return data.agents;
  }, []);

  // The roster is owner-scoped and small; one fetch per visit is enough.
  useEffect(() => {
    let cancelled = false;
    const myGen = ++rosterGenRef.current;
    loadAgents()
      .then((loaded) => {
        if (!cancelled && myGen === rosterGenRef.current) {
          setAgents(loaded);
          setRosterError(null);
        }
      })
      .catch((e) => {
        if (!cancelled && myGen === rosterGenRef.current) {
          setRosterError(
            e instanceof Error ? e.message : "Failed to load agents",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadAgents]);

  // Project list backing both the "@" task search and ticket-id link
  // resolution; same query key as the rest of the app, so it is shared cache.
  const { data: mentionProjects = EMPTY_PROJECTS } = useGetAllProjectsMinimal([
    "projectsAllMinimal",
  ]);
  const projectIdByPrefix = useMemo(() => {
    const byPrefix = new Map<string, number>();
    for (const project of mentionProjects as IProject[]) {
      if (project.uniqueIdentifier) byPrefix.set(project.uniqueIdentifier, project.id);
    }
    return byPrefix;
  }, [mentionProjects]);
  const projectIdForPrefix = useCallback(
    (prefix: string) => projectIdByPrefix.get(prefix),
    [projectIdByPrefix],
  );

  // The collapse choice is remembered per browser; default to open.
  useEffect(() => {
    try {
      setDetailsCollapsed(
        window.localStorage.getItem(DETAILS_COLLAPSED_KEY) === "1",
      );
    } catch {
      // Private browsing and hardened policies can reject localStorage.
    }
  }, []);

  // Default the team filter to whatever team the user was last working in on
  // a board (HTPR-6036), not a separately-remembered Agent Chat preference:
  // switching boards to another team and then opening Agent Chat should show
  // that team's agents. A manual change below only affects this component's
  // own state, so it wins for the rest of this visit without being written
  // back here (the keyboard team-cycle shortcut is the one thing that does
  // update the shared last-board-team value from this page).
  useEffect(() => {
    setTeamId(getLastBoardTeam());
  }, []);

  const setTeamFilter = (next: string | null) => {
    setTeamId(next);
  };

  // Below 900px the three panes stack: roster list, then chat, and the details
  // move behind an info button.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const onChange = () => setIsNarrow(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const loadMessages = useCallback(async (loadSessionId: string) => {
    const generation = ++loadGenRef.current;
    try {
      const res = await fetch(`/api/agent-chat/${loadSessionId}`);
      const data = (await res.json()) as {
        success?: boolean;
        messages?: TChatMessage[];
        activity?: AgentChatActivity[];
        error?: string;
        chatEnabled?: boolean;
        awaiting?: boolean;
        stoppable?: boolean;
      };
      if (!res.ok || !data.success || !Array.isArray(data.messages)) {
        throw new Error(data.error ?? "Failed to load messages");
      }
      // Ignore answers for a chat the user already left, never clobber an
      // optimistic send that is still in flight, and drop responses a newer
      // request for the same session has already superseded.
      if (
        sessionIdRef.current !== loadSessionId ||
        sendingRef.current ||
        generation !== loadGenRef.current
      )
        return;
      setMessages(data.messages);
      setActivity(Array.isArray(data.activity) ? data.activity : []);
      setAwaiting(Boolean(data.awaiting));
      setStoppable(Boolean(data.stoppable));
      setMessagesError(null);
      // Same signal a failed send sets: no live webhook subscribed to
      // chat.message, so the human side of the notice must survive a reload.
      if (data.chatEnabled === false) setDeliveryNotice(true);
      // Draining here would read awaitingRef before the render that follows
      // this setMessages has run, so it'd still see the stale (pre-reply)
      // value. The effect below (keyed on the derived `awaiting`) is the one
      // place that's guaranteed to observe the committed state instead.
    } catch (e) {
      if (
        sessionIdRef.current === loadSessionId &&
        generation === loadGenRef.current
      ) {
        setMessagesError(
          e instanceof Error ? e.message : "Failed to load messages",
        );
      }
    }
  }, []);

  const openAgentSession = useCallback(
    async (agentId: string) => {
      setSessionLoading(true);
      try {
        // One ongoing thread per agent: the route upserts, so re-selecting an
        // agent always lands on the same conversation.
        const res = await fetch("/api/ai-chat/create-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          session?: { id: string };
          error?: string;
        };
        if (!res.ok || !data.success || !data.session) {
          throw new Error(data.error ?? "Could not open chat");
        }
        // The user may have switched agents while this was in flight.
        if (selectedIdRef.current !== agentId) return;
        sessionIdRef.current = data.session.id;
        setSession({ id: data.session.id, agentId });
      } catch (e) {
        if (selectedIdRef.current === agentId) {
          setMessagesError(
            e instanceof Error ? e.message : "Could not open chat",
          );
        }
      } finally {
        if (selectedIdRef.current === agentId) setSessionLoading(false);
      }
    },
    [],
  );

  const clearSelectionState = () => {
    selectedIdRef.current = null;
    sessionIdRef.current = null;
    setSelectedId(null);
    setSession(null);
    setSessionLoading(false);
    setMessages(null);
    setActivity([]);
    setMessagesError(null);
    setAwaiting(false);
    setStoppable(false);
    setStopping(false);
    setDeliveryNotice(false);
    setDraft("");
    dismissMention();
  };

  const selectAgent = useCallback(
    (agent: TAgent) => {
      selectedIdRef.current = agent.id;
      sessionIdRef.current = null;
      // A queued follow-up belongs to the chat it was typed in, not whatever
      // agent gets selected next.
      messageQueueRef.current = [];
      // flushSync (rather than the normal batched update) commits the chat
      // pane, composer included, before this handler returns, so the
      // composerRef.focus() below still runs inside the tap's call stack --
      // mobile browsers only open the keyboard for a focus() that happens
      // synchronously in the user gesture (HTPR-6041 follow-up).
      flushSync(() => {
        setSelectedId(agent.id);
        setSession(null);
        setSessionLoading(false);
        setMessages(null);
        setActivity([]);
        setMessagesError(null);
        setAwaiting(false);
        setStoppable(false);
        setStopping(false);
        setDeliveryNotice(false);
        setDraft("");
        setQueuedMessages([]);
      });
      dismissMention();
      if (isMbl && agent.runtimeType === "EXTERNAL") composerRef.current?.focus();
      // The selection lives in the URL so a reload keeps the chat open.
      router.replace(
        `/agents/chat?agent=${encodeURIComponent(agent.slug ?? agent.id)}`,
        { scroll: false },
      );
      // Native agents are chatted with from the full AI chat surface; only
      // external ones get an in-pane session.
      if (agent.runtimeType !== "EXTERNAL") return;
      void openAgentSession(agent.id);
    },
    [router, openAgentSession, isMbl],
  );

  // Honor ?agent=<slug> once the roster is in (deep link, reload, palette).
  const agentParam = searchParams?.get("agent") ?? null;
  useEffect(() => {
    if (!agents || !agentParam || selectedIdRef.current) return;
    const match = agents.find(
      (a) => !a.revokedAt && (a.slug ?? a.id) === agentParam,
    );
    if (match) selectAgent(match);
  }, [agents, agentParam, selectAgent]);

  const sessionName = session?.id ?? null;
  useEffect(() => {
    if (!sessionName) return;
    void loadMessages(sessionName);
  }, [sessionName, loadMessages]);

  const feed = useMemo(
    () =>
      mergeAgentChatFeed(
        messages ?? [],
        activityRowsEnabled ? activity : [],
      ),
    [messages, activity, activityRowsEnabled],
  );
  const activeFeedFilter = activityRowsEnabled ? feedFilter : "all";
  const visibleFeed = useMemo(
    () => displayAgentChatFeed(feed, activeFeedFilter),
    [feed, activeFeedFilter],
  );
  const visibleFeedRevision = useMemo(
    () =>
      JSON.stringify(
        visibleFeed.map((item) =>
          item.kind === "message"
            ? [item.kind, item.id]
            : [item.kind, ...item.events.map((event) => event.id)],
        ),
      ),
    [visibleFeed],
  );

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const target = messageListRef.current;
      if (!target) return;
      target.scrollTo({ top: target.scrollHeight, behavior });
    },
    [],
  );

  const handleMessageListScroll = useCallback(() => {
    const target = messageListRef.current;
    if (!target) {
      setShowScrollToBottom(false);
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = target;
    setShowScrollToBottom(scrollTop + clientHeight < scrollHeight - 4);
  }, []);

  // Jump to the bottom when the feed gains or replaces an item (own send,
  // poll, or realtime nudge), including when the capped feed stays the same
  // length. Filter changes still need a fresh overflow measurement.
  const prevFeedRevisionRef = useRef("");
  useLayoutEffect(() => {
    const changed = visibleFeedRevision !== prevFeedRevisionRef.current;
    prevFeedRevisionRef.current = visibleFeedRevision;
    // Only follow an update when the user was already at (or near) the bottom;
    // background activity must not yank them away from older content.
    if (changed && !showScrollToBottom) scrollMessagesToBottom("smooth");
    handleMessageListScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleFeedRevision, activeFeedFilter]);
  useLayoutEffect(() => {
    // A different chat's feed identity has nothing to do with this one's;
    // don't let it suppress the next genuine feed update.
    prevFeedRevisionRef.current = "";
    scrollMessagesToBottom("auto");
    handleMessageListScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName]);

  awaitingRef.current = awaiting;
  // A failed delivery (deliveryNotice) leaves the ball with us: the composer
  // must reopen so the user can send again, and the poll must stay stopped.
  const composerLocked = awaiting && !deliveryNotice;

  // Drain a queued follow-up once the ball is actually back in our court.
  // Runs after render, so it always sees the awaiting value this render
  // computed -- unlike draining synchronously inside loadMessages, which ran
  // before awaitingRef had been updated and left the queue stuck.
  useEffect(() => {
    if (!awaiting) drainQueuedMessageRef.current();
  }, [awaiting]);

  // Record when the current wait began so the poll below can time out; a new
  // wait for the same session (a fresh send) restarts the clock.
  useEffect(() => {
    if (!awaiting || !session) {
      setAwaitingSince(null);
      return;
    }
    setAwaitingSince((prev) =>
      prev?.sessionId === session.id ? prev : { sessionId: session.id, at: Date.now() },
    );
  }, [awaiting, session]);

  useEffect(() => {
    if (!awaiting || !session) return;
    // The runtime has not enabled chat, so the message will never be
    // delivered and polling cannot help.
    if (deliveryNotice) return;
    const sinceAt =
      awaitingSince?.sessionId === session.id ? awaitingSince.at : Date.now();
    const remaining = sinceAt + AWAITING_POLL_MAX_MS - Date.now();
    if (remaining <= 0) return;
    const id = setInterval(
      () => void loadMessages(session.id),
      AWAITING_POLL_MS,
    );
    const stop = setTimeout(() => clearInterval(id), remaining);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [awaiting, session, deliveryNotice, awaitingSince, loadMessages]);

  // Realtime nudge: the send route broadcasts agent-chat:changed on this
  // user's private channel; refetch instead of waiting for the next poll.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      const channelName = userChannel(currentUser.id);
      const channel = client.subscribe(channelName);
      const onChatEvent = (
        payload: { sessionId?: string; agentId?: string } | undefined,
      ) => {
        const currentSessionId = sessionIdRef.current;
        if (!currentSessionId) return;
        if (
          payload?.sessionId === currentSessionId ||
          (activityRowsEnabled &&
            payload?.agentId &&
            payload.agentId === selectedIdRef.current)
        ) {
          void loadMessages(currentSessionId);
        }
      };
      channel.bind(AGENT_CHAT_EVENT, onChatEvent);

      unsubscribe = () => {
        channel.unbind(AGENT_CHAT_EVENT, onChatEvent);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [currentUser.id, loadMessages, activityRowsEnabled]);

  const selectedAgent = useMemo(
    () => (agents ?? []).find((a) => a.id === selectedId) ?? null,
    [agents, selectedId],
  );
  const isExternal = selectedAgent?.runtimeType === "EXTERNAL";

  const teams = useMemo(() => listTeams(agents ?? []), [agents]);

  // Alt+Shift+Arrow team cycling (HTPR-6036): the app-wide keydown handler
  // (GloablProviders.tsx, alongside Ctrl+B) bumps this atom's seq since it
  // has no other way to reach this page's team filter state. "All teams"
  // (null) is one of the stops, matching the dropdown below.
  const teamCycle = useRecoilValue(agentChatTeamCycleAtom);
  // Seeded from whatever the atom already holds at mount, not 0: the atom
  // retains its last event, so a fresh mount (e.g. navigating back to Agent
  // Chat after cycling teams elsewhere) must acknowledge that stale seq
  // instead of replaying it as a brand-new press.
  const teamCycleSeenRef = useRef(teamCycle?.seq ?? 0);
  // Shared by the atom-driven effect below and the Ctrl+K palette's
  // Next/Previous team entries (AllCommands.ts -> chatPaletteCommands.ts).
  const stepTeamCycle = useCallback(
    (direction: 1 | -1) => {
      const stops: (string | null)[] = [null, ...teams.map((t) => t.id)];
      const currentIndex = stops.indexOf(teamId);
      const nextIndex =
        (((currentIndex === -1 ? 0 : currentIndex) + direction) %
          stops.length +
          stops.length) %
        stops.length;
      const next = stops[nextIndex];
      setTeamId(next);
      if (next) setLastBoardTeam(next);
    },
    [teams, teamId],
  );
  useEffect(() => {
    if (!teamCycle || teamCycle.seq === teamCycleSeenRef.current) return;
    // The roster (and so `teams`) isn't loaded yet: stepTeamCycle's stops
    // array would be just [null], silently losing the cycle. Leave the seq
    // unacknowledged so this effect re-runs and replays it once agents load.
    if (agents === null) return;
    teamCycleSeenRef.current = teamCycle.seq;
    stepTeamCycle(teamCycle.direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stepTeamCycle
    // intentionally excluded: it closes over teamId, and re-running this on
    // every teamId change (including the ones it causes itself) would fight
    // the cycle. Only a new atom event should trigger a step.
  }, [teamCycle, teams, agents]);

  const roster = useMemo(() => {
    const visible = (agents ?? []).filter(
      (a) => a.revokedAt === null && a.archivedAt === null,
    );
    // A remembered team that no longer exists must not empty the roster.
    const activeTeam =
      teamId && teams.some((team) => team.id === teamId) ? teamId : null;
    const inTeam = activeTeam
      ? visible.filter((a) =>
          (a.boards ?? []).some((board) => board.teamId === activeTeam),
        )
      : visible;
    const needle = search.trim().toLowerCase();
    const matching = needle
      ? inTeam.filter((a) => a.displayName.toLowerCase().includes(needle))
      : inTeam;
    // Most recent post first; agents that never posted sink below the rest,
    // with a name tiebreak so the order is stable.
    return [...matching].sort((a, b) => {
      const at = a.lastPostedAt ?? "";
      const bt = b.lastPostedAt ?? "";
      if (at !== bt) return at < bt ? 1 : -1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [agents, search, teamId, teams]);

  // The actual POST, used by both a direct send and a drained queue item.
  // Reads the target session off sessionIdRef (not the `session` state
  // closure) so a queued send drained after the user switched agents can
  // still be safely dropped by the same staleness check a direct send uses.
  const sendMessageText = useCallback(async (text: string, queuedId?: string) => {
    const targetSessionId = sessionIdRef.current;
    if (!targetSessionId) return;
    const optimistic: TChatMessage = {
      // react-hooks/purity false-flags this pre-existing, unrelated line
      // purely from the shape of unrelated functions added elsewhere in this
      // component (confirmed by isolating each addition); sendMessageText
      // only ever runs from an event handler, never during render.
      // eslint-disable-next-line react-hooks/purity
      id: `optimistic-${Date.now()}`,
      role: "human",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setDeliveryNotice(false);
    setAwaiting(true);
    setStoppable(false);
    // A new message restarts the 15 minute awaiting-poll bound.
    setAwaitingSince(null);
    setMessages((prev) => [...(prev ?? []), optimistic]);
    sendingRef.current = true;
    setSending(true);
    let sent = false;
    try {
      const res = await fetch(`/api/agent-chat/${targetSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: TChatMessage;
        delivered?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success || !data.message) {
        throw new Error(data.error ?? "Failed to send message");
      }
      const sentMessage = data.message;
      sent = true;
      if (sessionIdRef.current !== targetSessionId) return;
      setMessages((prev) =>
        (prev ?? []).map((m) => (m.id === optimistic.id ? sentMessage : m)),
      );
      // The webhook outbox had no subscriber for chat.message: the agent will
      // never see this message unless its runtime is set up later.
      if (data.delivered === false) setDeliveryNotice(true);
    } catch (e) {
      if (sessionIdRef.current !== targetSessionId) return;
      // Roll the optimistic bubble back and reopen the composer.
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimistic.id));
      setAwaiting(false);
      setStoppable(false);
      if (queuedId) {
        // A drained queue item failing must not free up the next item to
        // fire out of order: put it back at the front and block draining
        // until it's removed.
        blockedQueueIdRef.current = queuedId;
        messageQueueRef.current = [{ id: queuedId, content: text }, ...messageQueueRef.current];
        setQueuedMessages(messageQueueRef.current);
      } else {
        setDraft(text);
      }
      toast.error(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      sendingRef.current = false;
      setSending(false);
      if (sent && sessionIdRef.current === targetSessionId) {
        void loadMessages(targetSessionId);
      }
    }
  }, [loadMessages]);

  const removeQueuedMessage = useCallback((id: string) => {
    messageQueueRef.current = messageQueueRef.current.filter(
      (item) => item.id !== id,
    );
    setQueuedMessages(messageQueueRef.current);
    // Removing the item that blocked draining clears the block; anything
    // still behind it in the queue is free to send again.
    if (blockedQueueIdRef.current === id) blockedQueueIdRef.current = null;
  }, []);

  const drainQueuedMessage = useCallback(() => {
    if (sendingRef.current) return;
    const queue = messageQueueRef.current;
    if (queue.length === 0) return;
    // Only the agent's reply (not the human's own next queued message)
    // clears the ball from our court -- draining while still awaiting would
    // fire a second message before the first got a reply.
    if (awaitingRef.current) return;
    const [next, ...rest] = queue;
    // A previously failed item stays at the front and blocks draining until
    // it's removed, so a later reply landing doesn't fire the next item out
    // of order.
    if (blockedQueueIdRef.current === next.id) return;
    messageQueueRef.current = rest;
    setQueuedMessages(rest);
    void sendMessageText(next.content, next.id);
  }, [sendMessageText]);

  const drainQueuedMessageRef = useRef(drainQueuedMessage);
  drainQueuedMessageRef.current = drainQueuedMessage;

  const handleStop = async () => {
    if (!session || !stoppable || stopping) return;
    const targetSessionId = session.id;
    setStopping(true);
    try {
      const res = await fetch(`/api/agent-chat/${targetSessionId}/stop`, { method: "POST" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to stop agent");
      if (sessionIdRef.current !== targetSessionId) return;
      setAwaiting(false);
      setStoppable(false);
      void loadMessages(targetSessionId);
    } catch (error) {
      if (sessionIdRef.current === targetSessionId) {
        toast.error(error instanceof Error ? error.message : "Failed to stop agent");
      }
    } finally {
      if (sessionIdRef.current === targetSessionId) setStopping(false);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!session || !text || sendingRef.current) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      toast.error("Message is too long (8000 characters max)");
      return;
    }
    setDraft("");
    dismissMention();
    composerRef.current?.focus();
    if (composerLocked) {
      // Same rationale as the optimistic message id above: this only runs
      // from an event handler, never during render.
      // eslint-disable-next-line react-hooks/purity
      const queued = { id: `queued-${Date.now()}`, content: text };
      messageQueueRef.current = [...messageQueueRef.current, queued];
      setQueuedMessages(messageQueueRef.current);
      return;
    }
    await sendMessageText(text);
  };
  // Stable reference for the palette-command listener below, which shouldn't
  // re-subscribe on every render just because handleSend is a new closure.
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  // Ctrl+Tab / Ctrl+Shift+Tab (and the Alt+ArrowDown/Up fallback, since
  // browsers reserve Ctrl+Tab for switching tabs) step through the currently
  // filtered roster, wrapping around at either end.
  const cycleAgent = useCallback(
    (direction: 1 | -1) => {
      if (roster.length === 0) return;
      const currentIndex = roster.findIndex((a) => a.id === selectedId);
      const nextIndex =
        currentIndex === -1
          ? 0
          : (currentIndex + direction + roster.length) % roster.length;
      selectAgent(roster[nextIndex]);
    },
    [roster, selectedId, selectAgent],
  );

  // Ctrl+O and the palette's "Open all links in latest reply" both need this.
  const openLatestReplyLinks = useCallback(() => {
    const latestWithLinks = [...(messages ?? [])]
      .reverse()
      .find(
        (m) => extractMessageLinks(m.content, projectIdForPrefix).length > 0,
      );
    if (!latestWithLinks) return;
    const links = extractMessageLinks(
      latestWithLinks.content,
      projectIdForPrefix,
    ).slice(0, 5);
    for (const href of links) window.open(href, "_blank", "noopener");
  }, [messages, projectIdForPrefix]);

  const dismissMention = () => {
    setMentionQuery(null);
    setMentionResults([]);
    setMentionIndex(0);
  };

  // AudioButton's dictation callback. There is no Tiptap editor here, so this
  // mirrors appendDictationToTitle (TaskTitleModal.tsx): append transcript
  // text to the plain-string draft, same append helper.
  const insertDictation = useCallback((transcript: string) => {
    setDraft((current) => appendTitleDictation(current, transcript));
    composerRef.current?.focus();
  }, []);

  // Detects an in-progress "@mention" ending at the cursor (must start at the
  // beginning of the text or after whitespace, same rule as the composer's
  // other autocomplete-style features).
  const handleComposerChange = (value: string, cursor: number) => {
    setDraft(value);
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) {
      if (mentionOpen) dismissMention();
      return;
    }
    setMentionStart(cursor - match[1].length - 1);
    setMentionQuery(match[1]);
  };

  // Same endpoint and request shape as the Ctrl+K task search modal
  // (src/components/Modals/commands/searchTasks.tsx).
  useEffect(() => {
    if (mentionQuery === null) return;
    const projectIds = (mentionProjects as IProject[]).map((p) => p.id);
    if (projectIds.length === 0) {
      // No projects loaded yet: clear results, but skip the state write
      // (and the re-render it triggers) when they're already empty, since
      // mentionProjects can keep changing reference while loading, which
      // would otherwise re-fire this effect in a loop for as long as the
      // popover stays open.
      setMentionResults((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let active = true;
    const timeout = setTimeout(
      async () => {
        try {
          const res = await axios.post("/api/tasks/searchAll", {
            projectIds,
            ...(mentionQuery.trim()
              ? { searchQuery: mentionQuery.trim() }
              : { mode: "recent" }),
          });
          if (!active) return;
          const results = Array.isArray(res.data) ? res.data : [];
          setMentionResults(results.slice(0, 8));
          setMentionIndex(0);
        } catch {
          if (active) setMentionResults([]);
        }
      },
      mentionQuery.trim() ? 150 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [mentionQuery, mentionProjects]);

  const pickMention = (task: ITask) => {
    const ticket = task.ticketNumber ?? `${task.projectId}-${task.uniqueIndex}`;
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(mentionStart + 1 + (mentionQuery?.length ?? 0));
    const inserted = `${before}${ticket} ${after}`;
    setDraft(inserted);
    dismissMention();
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + ticket.length + 1;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismissMention();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, Math.max(mentionResults.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && mentionResults[mentionIndex]) {
        e.preventDefault();
        pickMention(mentionResults[mentionIndex]);
        return;
      }
    }
    // Plain Enter already sends (unless Shift+Enter, which stays a newline);
    // Ctrl/Cmd+Enter is the same action, so no extra branch is needed for it.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleOpenFullChat = async () => {
    if (!selectedAgent || openingFullChat) return;
    setOpeningFullChat(true);
    try {
      const res = await fetch("/api/ai-chat/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: selectedAgent.id }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        session?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.success || !data.session) {
        throw new Error(data.error ?? "Could not open agent chat");
      }
      router.push(`/chat/${data.session.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open agent chat");
      setOpeningFullChat(false);
    }
  };

  const toggleDetails = () => {
    setDetailsCollapsed((prev) => {
      try {
        window.localStorage.setItem(DETAILS_COLLAPSED_KEY, prev ? "0" : "1");
      } catch {
        // Best effort only; the toggle still works for this visit.
      }
      return !prev;
    });
  };

  const backToRoster = () => {
    clearSelectionState();
    router.replace("/agents/chat", { scroll: false });
  };

  const createAgent = async () => {
    const displayName = newAgentName.trim();
    if (!displayName || creatingAgent) return;
    setCreatingAgent(true);
    setCreateAgentError(null);
    try {
      const res = await fetch("/api/mcp/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        agent?: { id: string };
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.success || !data.agent) {
        throw new Error(data.error ?? "Could not create agent");
      }
      const createdId = data.agent.id;
      // Store the token the moment the agent exists, before the roster
      // refresh below: the endpoint never returns it again, so a refresh
      // failure must not be able to take it down with it.
      if (data.token) {
        setNewAgentToken(data.token);
      } else {
        setShowCreateAgent(false);
        setNewAgentName("");
      }
      try {
        const myGen = ++rosterGenRef.current;
        const refreshed = await loadAgents();
        if (myGen === rosterGenRef.current) {
          setAgents(refreshed);
          setRosterError(null);
          const created = refreshed.find((a) => a.id === createdId);
          if (created) selectAgent(created);
        }
      } catch {
        // The agent was created (and its token, if any, is already shown);
        // a failed roster refresh just means it won't appear in the list
        // until the next reload, not that creation itself failed.
      }
    } catch (e) {
      setCreateAgentError(
        e instanceof Error ? e.message : "Could not create agent",
      );
    } finally {
      setCreatingAgent(false);
    }
  };

  // Any of the three keyboard shortcuts below would otherwise fire while a
  // popover, the create-agent modal, or the mobile details sheet is open and
  // stomp on typing/navigation inside it.
  const overlayOpen = mentionOpen || showCreateAgent || detailsSheetOpen;

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (overlayOpen) return;
      const isCycleKey =
        (e.ctrlKey && e.key === "Tab") ||
        // Excludes Shift: Alt+Shift+Arrow is the app-wide team-cycle
        // shortcut (GloablProviders.tsx) and must not also fire this.
        (e.altKey && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp"));
      if (isCycleKey) {
        // A focused control other than the composer (the team filter
        // <select>, a button, a search input) owns Alt+Arrow for its own
        // native navigation; only the composer and the page background are
        // fair game for the roster-cycle shortcut.
        const target = e.target;
        if (
          target instanceof HTMLElement &&
          target !== composerRef.current &&
          ["SELECT", "INPUT", "TEXTAREA", "BUTTON"].includes(target.tagName)
        ) {
          return;
        }
        // Switching agents clears the composer draft (selectAgent below), so
        // don't fire while the composer has an unsent message: an Alt+Arrow
        // meant to move the cursor, or a stray Ctrl+Tab, would otherwise
        // silently drop what the user was typing. Reads draftRef (not
        // `draft` directly) so this effect doesn't need to re-run, and
        // re-add the window listener, on every keystroke.
        if (
          document.activeElement === composerRef.current &&
          draftRef.current.trim() !== ""
        ) {
          return;
        }
        e.preventDefault();
        const direction = e.key === "Tab" ? (e.shiftKey ? -1 : 1) : e.key === "ArrowDown" ? 1 : -1;
        cycleAgent(direction);
        return;
      }
      // Ctrl+O otherwise opens the browser's file picker.
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openLatestReplyLinks();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayOpen, cycleAgent, openLatestReplyLinks]);

  // Ctrl+K palette bridge: the "Agent Chat" command group (AllCommands.ts,
  // only shown while this page is open) dispatches these instead of trying
  // to reach into this component's state from the palette's dispatcher.
  useEffect(() => {
    const onPaletteCommand = (e: Event) => {
      const detail = (e as CustomEvent<TAgentChatCommand>).detail;
      switch (detail) {
        case "next-agent":
          cycleAgent(1);
          return;
        case "previous-agent":
          cycleAgent(-1);
          return;
        case "send-message":
          void handleSendRef.current();
          return;
        case "open-links":
          openLatestReplyLinks();
          return;
        case "add-agent":
          setShowCreateAgent(true);
          return;
        case "next-team":
          stepTeamCycle(1);
          return;
        case "previous-team":
          stepTeamCycle(-1);
          return;
      }
    };
    window.addEventListener(AGENT_CHAT_COMMAND_EVENT, onPaletteCommand);
    return () =>
      window.removeEventListener(AGENT_CHAT_COMMAND_EVENT, onPaletteCommand);
  }, [cycleAgent, openLatestReplyLinks, stepTeamCycle]);

  // Put the cursor in the composer the moment it becomes usable: on initial
  // load (deep link or roster click) and again after a message sends, so
  // typing can continue without reaching for the mouse.
  useEffect(() => {
    if (isExternal && session && !composerLocked) composerRef.current?.focus();
  }, [isExternal, session, composerLocked, selectedId]);

  const rosterPane = (
    <aside
      className={cn(
        "flex flex-col min-h-0",
        isNarrow ? "flex-1" : "w-[300px] shrink-0 border-r border-comment-description-border",
      )}
    >
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="px-1 text-[16px] font-semibold">Agent Chat</h1>
          <button
            type="button"
            onClick={() => setShowCreateAgent(true)}
            aria-label="Add agent"
            className={cn(
              MOBILE_TARGET,
              "rounded-[4px] text-text-light-gray hover:text-white-black hover:bg-hoverCardBackground",
            )}
          >
            <Plus size={16} />
          </button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents"
          aria-label="Search agents"
          className="mt-2 w-full rounded-[4px] bg-cardBackground px-3 py-1.5 text-dense outline-none placeholder:text-text-light-gray"
        />
        {teams.length > 0 && (
          <AgentSelect
            value={teamId ?? ""}
            ariaLabel="Filter agents by team"
            onChange={(next) => setTeamFilter(next || null)}
            className="mt-2 w-full"
          >
            <AgentOption value="">All teams</AgentOption>
            {teams.map((team) => (
              <AgentOption key={team.id} value={team.id}>
                {team.name}
              </AgentOption>
            ))}
          </AgentSelect>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {rosterError && (
          <p className="px-2 py-3 text-meta text-red-500">{rosterError}</p>
        )}
        {!rosterError && !agents && (
          <p className="px-2 py-3 text-meta text-text-light-gray">
            Loading agents…
          </p>
        )}
        {agents && roster.length === 0 && (
          <p className="px-2 py-3 text-meta text-text-light-gray">
            No agents match.
          </p>
        )}
        {roster.map((agent) => (
          <RosterRow
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedId}
            onSelect={selectAgent}
          />
        ))}
      </div>
    </aside>
  );

  const detailsContent = selectedAgent ? (
    <AgentDetail
      agentId={selectedAgent.slug ?? selectedAgent.id}
      currentUser={currentUser}
      embedded
    />
  ) : null;

  const chatPane = selectedAgent ? (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-comment-description-border px-4 py-3">
        {isNarrow && (
          <button
            type="button"
            onClick={backToRoster}
            aria-label="Back to agents"
            className="text-text-light-gray hover:text-white-black"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <AgentAvatar agentId={selectedAgent.id} name={selectedAgent.displayName} photoURL={selectedAgent.photoURL} size={28} className="text-[11px]" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold">
            {selectedAgent.displayName}
          </p>
          <p className="truncate text-meta text-text-light-gray">
            {chatStatusText(selectedAgent)}
          </p>
        </div>
        <span className="flex-1" />
        {!isNarrow && (
          <button
            type="button"
            onClick={toggleDetails}
            aria-label={detailsCollapsed ? "Show details" : "Hide details"}
            className="text-text-light-gray hover:text-white-black"
          >
            {detailsCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        {isNarrow && (
          <button
            type="button"
            onClick={() => setDetailsSheetOpen(true)}
            aria-label="Agent details"
            className="text-text-light-gray hover:text-white-black"
          >
            <Info size={16} />
          </button>
        )}
      </header>

      {!isExternal ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="max-w-[340px] text-dense text-text-light-gray">
            {selectedAgent.displayName} is a Hypertask native agent. Its chat
            lives in the full AI chat surface.
          </p>
          <button
            type="button"
            disabled={openingFullChat}
            onClick={() => void handleOpenFullChat()}
            className="text-dense text-hypertasks-purple disabled:opacity-50"
          >
            {openingFullChat ? "Opening…" : "Open full chat"}
          </button>
        </div>
      ) : (
        <>
          {activityRowsEnabled && (
            <div className="shrink-0 border-b border-comment-description-border px-4 py-2">
              <FeedFilter value={feedFilter} onChange={setFeedFilter} />
            </div>
          )}
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {showScrollToBottom && (
              <ScrollToBottomButton
                onClick={() => scrollMessagesToBottom("smooth")}
              />
            )}
          <div
            ref={messageListRef}
            onScroll={handleMessageListScroll}
            className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
          >
            {messagesError && (
              <p className="text-meta text-red-500">{messagesError}</p>
            )}
            {(sessionLoading || (!messages && !messagesError)) && (
              <p className="text-meta text-text-light-gray">Loading chat…</p>
            )}
            {messages && visibleFeed.length === 0 && (
              <p className="text-meta text-text-light-gray">
                {emptyFeedText(activeFeedFilter, selectedAgent.displayName)}
              </p>
            )}
            {visibleFeed.map((item) =>
              item.kind === "message" ? (
                <MessageBubble
                  key={item.id}
                  message={item}
                  projectIdForPrefix={projectIdForPrefix}
                />
              ) : (
                <ActivityGroup key={item.id} group={item} />
              ),
            )}
            {chatStopAndTimeoutEnabled &&
              queuedMessages.map((item) => (
                <QueuedMessageBubble
                  key={item.id}
                  item={item}
                  onCancel={removeQueuedMessage}
                />
              ))}
            {awaiting && activeFeedFilter !== "activity" && !deliveryNotice && (
              <div
                className="flex items-center gap-2 text-meta text-text-light-gray"
                role="status"
              >
                <TypingIndicator />
                <span>{selectedAgent.displayName} is working</span>
                {chatStopAndTimeoutEnabled && stoppable && (
                  <button
                    type="button"
                    onClick={() => void handleStop()}
                    disabled={stopping}
                    className="font-medium hover:text-white-black disabled:opacity-50"
                  >
                    {stopping ? "Stopping…" : "Stop"}
                  </button>
                )}
              </div>
            )}
          </div>
          </div>
          {/* Card surface under the well: the two tokens differ in every theme, so the box stays visible on AMOLED (well = page) and porcelain (card = page). */}
          <div className="shrink-0 bg-cardBackground px-4 pb-4 pt-1">
            {deliveryNotice && (
              <p className="mb-2 text-meta text-text-light-gray">
                This agent&apos;s runtime has not enabled chat yet.
              </p>
            )}
            {!chatStopAndTimeoutEnabled && queuedMessages.length > 0 && (
              <QueuedMessagesStrip
                items={queuedMessages}
                onRemove={removeQueuedMessage}
              />
            )}
            <div className="relative flex items-end gap-2">
              {mentionOpen && (
                <div className="absolute bottom-full left-0 mb-1 max-h-[220px] w-[320px] overflow-y-auto rounded-[4px] bg-modalBackground py-1 shadow-md">
                  {mentionResults.length === 0 ? (
                    <p className="px-3 py-2 text-meta text-text-light-gray">
                      {mentionQuery?.trim() ? "No matching tasks" : "Type to search tasks"}
                    </p>
                  ) : (
                    mentionResults.map((task, i) => (
                      <button
                        key={task.id}
                        type="button"
                        onMouseEnter={() => setMentionIndex(i)}
                        onClick={() => pickMention(task)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-dense",
                          i === mentionIndex ? "bg-hoverCardBackground" : "",
                        )}
                      >
                        <span className="shrink-0 text-text-light-gray">
                          {task.ticketNumber?.toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => handleComposerChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                onKeyDown={handleComposerKeyDown}
                rows={2}
                placeholder={
                  composerLocked
                    ? `${selectedAgent.displayName} is working -- this will queue`
                    : `Message ${selectedAgent.displayName}`
                }
                aria-label={`Message ${selectedAgent.displayName}`}
                className="flex-1 resize-none rounded-[4px] bg-newcomment-well px-3 py-2 text-dense outline-none placeholder:text-text-light-gray disabled:opacity-50"
              />
              <AudioButton
                id="agent-chat-audio-button"
                editor={null}
                callbackHandler={insertDictation}
                toggleRecording={setIsRecording}
                globalRecording={isRecording}
                hasText={draft.trim().length > 0}
                onProcessingChange={setIsDictationProcessing}
                disabled={sending}
                ariaLabel="Dictate message"
                className="min-h-9 gap-1 rounded-[4px] px-2 text-text-light-gray hover:bg-hoverCardBackground"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!draft.trim() || sending || isRecording || isDictationProcessing}
                aria-label={composerLocked ? "Queue message" : "Send message"}
                className={cn(
                  MOBILE_TARGET,
                  "rounded-[4px] bg-shadcn-primary text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 px-3 text-dense font-medium",
                )}
              >
                {composerLocked ? "Queue" : "Send"}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  ) : (
    <section className="flex flex-1 items-center justify-center">
      <p className="text-dense text-text-light-gray">
        Select an agent to start chatting.
      </p>
    </section>
  );

  const detailsSheet =
    isNarrow && detailsSheetOpen && selectedAgent ? (
      <div className="fixed inset-0 z-50">
        <button
          type="button"
          aria-label="Close details"
          onClick={() => setDetailsSheetOpen(false)}
          className="absolute inset-0 bg-black/60"
        />
        <div className="absolute right-0 top-0 h-full w-[85%] max-w-[380px] overflow-y-auto bg-pageBackground shadow-md">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-dense font-medium text-text-light-gray">
              Agent details
            </span>
            <button
              type="button"
              onClick={() => setDetailsSheetOpen(false)}
              aria-label="Close details"
              className="text-text-light-gray hover:text-white-black"
            >
              <X size={16} />
            </button>
          </div>
          {detailsContent}
        </div>
      </div>
    ) : null;

  const closeCreateAgent = () => {
    if (creatingAgent) return;
    // A token is showing only right after a successful create; closing here
    // always means the user has seen it (or chose not to), never mid-request.
    setShowCreateAgent(false);
    setCreateAgentError(null);
    setNewAgentName("");
    setNewAgentToken(null);
    setTokenCopied(false);
  };

  const copyNewAgentToken = async () => {
    if (!newAgentToken) return;
    try {
      await navigator.clipboard.writeText(newAgentToken);
      setTokenCopied(true);
    } catch {
      // Clipboard access can be blocked (permissions, insecure context); the
      // token stays selectable in the input either way.
    }
  };

  const createAgentModal = showCreateAgent ? (
    <ModalContainerCustom
      id="create-agent-modal"
      isOpen={true}
      show={true}
      toggle={closeCreateAgent}
      // Once the one-time token is showing, an accidental outside click or
      // Escape press must not discard it: force the explicit Done/copy
      // affordance instead.
      shouldCloseOnClickOutside={!newAgentToken}
      keyboard={!newAgentToken}
      className="sm:min-w-[400px]"
    >
      <ModalHeaderComp header="Add agent" />
      <div className="px-6 pb-4">
        {newAgentToken ? (
          <>
            <p className="text-dense text-white-black">
              Agent created. Copy its token now, it will not be shown again.
            </p>
            <input
              readOnly
              value={newAgentToken}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Agent token"
              className="mt-2 w-full border-b border-light-black-border-1 bg-transparent px-0 py-1.5 text-meta text-white-black"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void copyNewAgentToken()}
                className="rounded-[4px] px-3 py-1.5 text-dense text-text-light-gray hover:bg-hoverCardBackground"
              >
                {tokenCopied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={closeCreateAgent}
                className="rounded-[4px] bg-shadcn-primary px-3 py-1.5 text-dense font-medium text-primary-foreground hover:opacity-80"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <ModalInput
              value={newAgentName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewAgentName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") void createAgent();
                if (e.key === "Escape") closeCreateAgent();
              }}
              placeholder="Agent name"
              aria-label="Agent name"
              className="border-b border-light-black-border-1 px-0"
            />
            {createAgentError && (
              <p className="mt-2 text-meta text-red-500">{createAgentError}</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateAgent}
                disabled={creatingAgent}
                className="rounded-[4px] px-3 py-1.5 text-dense text-text-light-gray hover:bg-hoverCardBackground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createAgent()}
                disabled={creatingAgent || !newAgentName.trim()}
                className="rounded-[4px] bg-shadcn-primary px-3 py-1.5 text-dense font-medium text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingAgent ? "Creating…" : "Create"}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalContainerCustom>
  ) : null;

  let mobileAgentChatHeight: string | undefined;
  if (isMbl && mobileAgentChatViewportEnabled) {
    mobileAgentChatHeight = mobileAgentChatViewport
      ? `${mobileAgentChatViewport.visibleHeight}px`
      : "100dvh";
  }

  if (isNarrow) {
    return (
      <div
        className={cn(
          "flex h-screen flex-col overflow-hidden bg-pageBackground text-white-black text-[14px]",
          // The app shell reserves a fixed top bar and bottom tab bar (see
          // globals.scss .mobile-tab-bar-content); AI_Chat_Layout normally adds
          // this inset but bails out early for /agents/chat, so we add it
          // ourselves or the composer lands under the tab bar (HTPR-6041).
          // isMbl-gated: a merely-narrow desktop window has neither bar.
          isMbl &&
            "mobile-tab-bar-content pt-[var(--mobile-top-bar-h)] pb-[var(--mobile-dock-h,64px)]",
        )}
        style={{ height: mobileAgentChatHeight }}
      >
        {selectedAgent ? chatPane : rosterPane}
        {detailsSheet}
        {createAgentModal}
      </div>
    );
  }

  const content = (
    <div className="flex h-screen overflow-hidden bg-pageBackground text-white-black text-[14px]">
      {rosterPane}
      {chatPane}
      {selectedAgent && !detailsCollapsed && (
        <aside className="min-h-0 w-[380px] shrink-0 overflow-y-auto border-l border-comment-description-border xl:w-[560px] 2xl:w-[760px]">
          {detailsContent}
        </aside>
      )}
      {createAgentModal}
    </div>
  );

  return (
    <>
      {appShellRailOn && (
        <AppShellRail variant="global" currentUser={currentUser} />
      )}
      {appShellRailOn ? (
        <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div>
      ) : (
        content
      )}
    </>
  );
};

export default AgentChatClient;
