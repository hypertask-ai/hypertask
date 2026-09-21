"use client";
import { useAgentChatView } from "./useAgentChatView";
import { TChatMessage, TProposalAction } from "./AgentChatViewParts";
/* eslint-disable @next/next/no-img-element */
import { AGENT_CHAT_EVENT } from "@/lib/realtime/shared";
import { AGENT_CHAT_COMMAND_EVENT, type TAgentChatCommand } from "@/lib/agents/chatPaletteCommands";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { appShellRailAtom, agentChatTeamCycleAtom, agentChatMobileFullscreenAtom, mobileTopBarTitleAtom } from "@/store";
import { IUser, IProject, ITask } from "@/models/model";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import toast from "react-hot-toast";
import { listTeams } from "@/lib/agents/registerView";
import { extractMessageLinks } from "@/lib/agents/messageLinks";
import { connectRealtimeClient, releaseRealtimeClientIfIdle } from "@/lib/realtime/client";
import { userChannel } from "@/lib/realtime/shared";
import type { TAgent } from "../AgentsRegister";
import { bumpRosterChatRecency, sortRosterByActivity } from "./rosterSort";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import axios from "axios";
import { useFlag } from "@/hooks/useFlag";
import { AGENT_CHAT_PARKED_MESSAGE, AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG } from "@/lib/agentRuns/model";
import { HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG, HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG, HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG, HTPR_6553_AGENT_CHAT_POLLING_FLAG } from "@/lib/flags/keys";
import { useMobileVisualViewport } from "@/hooks/General/useMobileVisualViewport";
import { getLastBoardTeam, setLastBoardTeam } from "@/lib/lastBoardTeam";
import { appendTitleDictation } from "@/components/Modals/CreateTaskGloballyModal/titleDictation";
import { readDraft, writeDraft } from "@/lib/agents/chatDrafts";
import { markChatRead, saveDraftToServer } from "@/lib/agents/chatViewerState";
import { agentChatExtraRowsRevision, displayAgentChatFeed, mergeAgentChatFeed, shouldAutoScrollToBottom, type AgentChatActivity, type AgentChatFilter } from "@/lib/agents/chatActivityFeed";
// While we are waiting for an external agent to answer, the only way to see
// the reply arrive is to keep asking.
const AWAITING_POLL_MS = 4000;
// The passive activity feed has no realtime channel of its own, so it needs a
// poll of its own to meet the 10-second freshness the ticket asks for.
const ACTIVITY_POLL_MS = 5000;
// Availability changes without a chat event when a runtime heartbeat starts
// or expires, so idle chats need a low-frequency refresh of their own.
const CHAT_AVAILABILITY_POLL_MS = 30_000;
// Realtime still refetches when the reply lands; the interval is only a
// fallback. Polling chat surfaces a generic failure after this bound.
const AWAITING_POLL_MAX_MS = 3 * 60 * 1000;
const LEGACY_AWAITING_POLL_MAX_MS = 15 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 8000;
const DETAILS_COLLAPSED_KEY = "agentChat.detailsCollapsed";
type TAgentChatSession = { id: string; agentId: string };
/** Prefer the active team board, else the agent's first board (HTPR-6407 mic). */
function agentDictationProjectId(
  agent: TAgent | null | undefined,
  teamId: string | null,
): number | null {
  const boards = agent?.boards ?? [];
  if (boards.length === 0) return null;
  if (teamId) {
    const match = boards.find((board) => board.teamId === teamId);
    if (match) return match.id;
  }
  return boards[0]?.id ?? null;
}
interface IProp {
  currentUser: IUser;
  roomsEnabled: boolean;
}
// Stable reference so the "@" mention effect below does not see a new
// array (and re-fire) on every render while projects are still loading.
const EMPTY_PROJECTS: IProject[] = [];
const AgentChatClient = (props: IProp) => {
  const { currentUser, roomsEnabled } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMbl = useContext(MobileViewContext);
  const mobileAgentChatViewportEnabled = useFlag(
    "htpr-6129-mobile-agent-chat-viewport",
  );
  const mobileLayoutEnabled = useFlag(HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG);
  const mobileFullscreenFlag = useFlag(HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG);
  const activityRowsEnabled = useFlag("htpr-6094-agent-activity-rows");
  const rosterStatusEnabled = useFlag("htpr-6287-agent-chat-roster-status");
  // Idle durations and the idle-to-inactive flip have to move while the chat
  // sits open, so the roster re-renders on a clock; no refetch involved.
  const [rosterNow, setRosterNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rosterStatusEnabled) return;
    const tick = setInterval(() => setRosterNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [rosterStatusEnabled]);
  const liveSortEnabled = useFlag(HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG);
  const chatStopAndTimeoutEnabled = useFlag(AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG);
  const pollingChatEnabled = useFlag(HTPR_6553_AGENT_CHAT_POLLING_FLAG);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const setMobileTopBarTitle = useSetRecoilState(mobileTopBarTitleAtom);
  const setAgentChatMobileFullscreen = useSetRecoilState(
    agentChatMobileFullscreenAtom,
  );
  const [agents, setAgents] = useState<TAgent[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mobileAgentChatViewport = useMobileVisualViewport(
    isMbl &&
      (mobileAgentChatViewportEnabled ||
        mobileLayoutEnabled ||
        (mobileFullscreenFlag && Boolean(selectedId))),
  );
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
  const [deliveryMode, setDeliveryMode] = useState<
    "webhook" | "polling" | null
  >(null);
  // When the current wait for this session's reply began (last send, or the
  // stored human message time after a reload).
  const [awaitingSince, setAwaitingSince] = useState<{
    sessionId: string;
    at: number;
  } | null>(null);
  const [replyTimedOut, setReplyTimedOut] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
  const detailsDialogRef = useRef<HTMLDialogElement>(null);
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
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionLoadError, setMentionLoadError] = useState(false);
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
  // What selectAgent last restored into the composer. Text equal to this was
  // not typed in this visit, so the agent-cycle guard below can ignore it.
  const restoredDraftRef = useRef("");
  // Monotonic request generation for loadMessages, so a late response can be
  // recognized as superseded by a newer one for the same session.
  const loadGenRef = useRef(0);
  // The session whose server-side draft has already been folded in. The draft
  // is taken from the server once per thread and never again, or every refetch
  // would overwrite what is being typed right now.
  const draftHydratedRef = useRef<string | null>(null);
  // Mobile keyboards only open for a focus() that lands synchronously inside
  // the tap's event handler, so selectAgent needs the composer's DOM node
  // before that handler returns (see the flushSync call there).
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerEditorRef = useRef<Editor | null>(null);
  const focusComposer = () => {
    if (composerEditorRef.current) {
      composerEditorRef.current.commands.focus();
      return;
    }
    composerRef.current?.focus();
  };
  // Same pattern as loadGenRef: the mount-time roster fetch and the
  // post-create-agent refresh both call loadAgents/setAgents, so a slower
  // mount fetch resolving after a refresh must not clobber it.
  const rosterGenRef = useRef(0);
  // A project refetch or a new query can start before the previous task search
  // settles. Only the newest generation may update the popover.
  const mentionSearchGenRef = useRef(0);
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
  const {
    data: mentionProjects = EMPTY_PROJECTS,
    isFetching: mentionProjectsLoading,
    isError: mentionProjectsLoadError,
  } = useGetAllProjectsMinimal(["projectsAllMinimal"]);
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
  // move behind an info button. useLayoutEffect so a reload on a phone does
  // not paint the desktop three-pane shell for a frame.
  useLayoutEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const onChange = () => {
      setIsNarrow(query.matches);
      // The details sheet only exists in the narrow layout; widening past the
      // breakpoint would otherwise unmount it with the flag still set, leaving
      // it to spring open on the way back.
      if (!query.matches) setDetailsSheetOpen(false);
    };
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const loadMessages = useCallback(async (loadSessionId: string) => {
    const generation = ++loadGenRef.current;
    try {
      const res = await fetch(`/api/agent-chat/${loadSessionId}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        success?: boolean;
        messages?: TChatMessage[];
        activity?: AgentChatActivity[];
        error?: string;
        chatEnabled?: boolean;
        deliveryMode?: "webhook" | "polling" | null;
        awaiting?: boolean;
        viewer?: { draft: string | null; unreadCount: number } | null;
        sharedConversationEnabled?: boolean;
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
      setMessagesError(null);
      setDeliveryMode(data.deliveryMode ?? null);
      // Same signal a failed send sets: no live delivery path means the human
      // side of the notice must survive a reload. The parked line already says
      // it in the thread, so two copies of the same sentence would be noise.
      setDeliveryNotice(
        data.chatEnabled === false &&
          data.messages.at(-1)?.content !== AGENT_CHAT_PARKED_MESSAGE,
      );
      // First load of this thread: reconcile the two draft copies. Whatever is
      // on this device wins, because it is what was typed most recently here,
      // and it gets pushed up so the next device sees it. An empty device slot
      // takes the server's copy, which is what makes a draft cross devices.
      // Viewer rows exist for private owner chats too; only the shared roster
      // stays behind the flag.
      if (data.viewer && draftHydratedRef.current !== loadSessionId) {
        draftHydratedRef.current = loadSessionId;
        const local = draftRef.current;
        const stored = data.viewer?.draft ?? "";
        if (local.trim() !== "") {
          if (local !== stored) saveDraftToServer(loadSessionId, local);
        } else if (stored !== "") {
          draftRef.current = stored;
          setDraft(stored);
          if (selectedIdRef.current)
            writeDraft(currentUser.id, selectedIdRef.current, stored);
        }
      }
      // Reading the newest page is catching up, so the unread marker moves.
      if (data.viewer && data.viewer.unreadCount > 0) {
        markChatRead(loadSessionId);
      }
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
  }, [currentUser.id]);
  // Confirm or dismiss a proposed ticket. The server owns the decision; this
  // just refetches so every tab lands on the state the server committed.
  const handleProposalAction = useCallback<TProposalAction>(
    async (proposalId, action) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) return;
      try {
        const res = await fetch(
          `/api/agent-chat/${activeSessionId}/proposals/${proposalId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );
        const data = (await res.json()) as {
          success?: boolean;
          error?: string;
        };
        if (!res.ok || !data.success) {
          toast.error(data.error ?? "Could not update the proposal");
        }
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Could not update the proposal",
        );
      } finally {
        await loadMessages(activeSessionId);
      }
    },
    [loadMessages],
  );
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
    // Leaving the chat is not the same as discarding the message: keep it for
    // when this agent is opened again.
    if (selectedIdRef.current) {
      writeDraft(currentUser.id, selectedIdRef.current, draftRef.current);
    }
    selectedIdRef.current = null;
    sessionIdRef.current = null;
    draftHydratedRef.current = null;
    setSelectedId(null);
    setSession(null);
    setSessionLoading(false);
    setMessages(null);
    setActivity([]);
    setMessagesError(null);
    setAwaiting(false);
    setStopping(false);
    setDeliveryNotice(false);
    setDeliveryMode(null);
    setReplyTimedOut(false);
    setDraft("");
    dismissMention();
  };
  const selectAgent = useCallback(
    (agent: TAgent) => {
      // Read the outgoing agent off the ref before it is overwritten, or the
      // draft lands under the agent being switched to.
      const leaving = selectedIdRef.current;
      if (leaving && leaving !== agent.id) {
        writeDraft(currentUser.id, leaving, draftRef.current);
      }
      selectedIdRef.current = agent.id;
      sessionIdRef.current = null;
      draftHydratedRef.current = null;
      // draftRef is normally refreshed by a passive effect, which can lag
      // behind two switches in the same task (holding Ctrl+Tab). Setting it
      // here means the next switch always writes the draft it actually left.
      const restored = readDraft(currentUser.id, agent.id);
      draftRef.current = restored;
      restoredDraftRef.current = restored;
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
        setStopping(false);
        setDeliveryNotice(false);
        setDeliveryMode(null);
        setReplyTimedOut(false);
        // This same path runs for a reload (the ?agent= effect calls it), so
        // restoring here covers both switching agents and coming back.
        setDraft(restored);
        setQueuedMessages([]);
      });
      dismissMention();
      if (isMbl && agent.runtimeType === "EXTERNAL") composerRef.current?.focus();
      if (isMbl && agent.runtimeType === "EXTERNAL") focusComposer();
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
    [router, openAgentSession, isMbl, currentUser.id],
  );
  // Honor ?agent=<slug> once the roster is in (deep link, reload, palette).
  // The raw id resolves too: links written server side (a confirmed proposal's
  // ticket, for one) have no slug to hand.
  const agentParam = searchParams?.get("agent") ?? null;
  useEffect(() => {
    if (!agents || !agentParam || selectedIdRef.current) return;
    const match = agents.find(
      (a) => !a.revokedAt && (a.slug ?? a.id) === agentParam,
    ) ?? agents.find((a) => !a.revokedAt && a.id === agentParam);
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
  // The queued-follow-up strip and the "is working" typing row sit in the
  // same scroll container as the feed (see the JSX below) but aren't part of
  // `visibleFeed`, so a queued send or the typing row appearing must count as
  // a feed change too or the list silently stops following (HTPR-6291).
  const extraRowsRevision = agentChatExtraRowsRevision({
    queuedMessageIds: queuedMessages.map((item) => item.id),
    queuedRowsVisible: chatStopAndTimeoutEnabled && activeFeedFilter !== "activity",
    typingRowVisible:
      awaiting &&
      activeFeedFilter !== "activity" &&
      !deliveryNotice &&
      !replyTimedOut,
  });
  // Jump to the bottom when the feed gains or replaces an item (own send,
  // poll, or realtime nudge), including when the capped feed stays the same
  // length. Filter changes still need a fresh overflow measurement.
  const prevFeedRevisionRef = useRef("");
  const prevExtraRowsRevisionRef = useRef("");
  // The first time a session's real content paints, force the landing to the
  // bottom no matter what showScrollToBottom says: the user cannot have
  // legitimately scrolled away from content that has never been on screen.
  // Without this, a reload that loads messages then activity back-to-back
  // could mis-measure scroll distance on the very first (still-empty) pass,
  // latch showScrollToBottom to true, and then stay stuck there forever --
  // every later update honors "user scrolled up" and skips the auto-scroll,
  // and the button never clears itself without a manual scroll.
  const initialScrollDoneRef = useRef(false);
  useLayoutEffect(() => {
    const changed =
      visibleFeedRevision !== prevFeedRevisionRef.current ||
      extraRowsRevision !== prevExtraRowsRevisionRef.current;
    prevFeedRevisionRef.current = visibleFeedRevision;
    prevExtraRowsRevisionRef.current = extraRowsRevision;
    const isFirstContent = !initialScrollDoneRef.current && visibleFeed.length > 0;
    // "auto" (instant), not "smooth": handleMessageListScroll below reads
    // scrollTop synchronously right after, and a smooth scroll hasn't moved
    // yet at that point, so it would misjudge distance-from-bottom.
    if (
      shouldAutoScrollToBottom({
        feedChanged: changed,
        isFirstContent,
        userScrolledAway: showScrollToBottom,
      })
    ) {
      scrollMessagesToBottom("auto");
    }
    if (visibleFeed.length > 0) initialScrollDoneRef.current = true;
    handleMessageListScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleFeedRevision, activeFeedFilter, extraRowsRevision]);
  useLayoutEffect(() => {
    // A different chat's feed identity has nothing to do with this one's;
    // don't let it suppress the next genuine feed update, and don't let it
    // borrow this new session's "have we shown its first content yet" state.
    prevFeedRevisionRef.current = "";
    prevExtraRowsRevisionRef.current = "";
    initialScrollDoneRef.current = false;
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
  // wait for the same session (a fresh send) restarts the clock. On reload the
  // stored message time prevents an old unanswered turn looking fresh again.
  useEffect(() => {
    if (!awaiting || !session) {
      setAwaitingSince(null);
      setReplyTimedOut(false);
      return;
    }
    const latestMessageAt = Date.parse(messages?.at(-1)?.createdAt ?? "");
    setAwaitingSince((prev) =>
      prev?.sessionId === session.id
        ? prev
        : {
            sessionId: session.id,
            at: Number.isNaN(latestMessageAt) ? Date.now() : latestMessageAt,
          },
    );
  }, [awaiting, messages, session]);
  useEffect(() => {
    if (!awaiting || !session) return;
    // The runtime has not enabled chat, so the message will never be
    // delivered and polling cannot help.
    if (deliveryNotice) return;
    const sinceAt =
      awaitingSince?.sessionId === session.id ? awaitingSince.at : Date.now();
    const maxWait = pollingChatEnabled
      ? AWAITING_POLL_MAX_MS
      : LEGACY_AWAITING_POLL_MAX_MS;
    const remaining = sinceAt + maxWait - Date.now();
    const markTimedOut = () => {
      if (!pollingChatEnabled) return;
      console.error("[agent-chat] no reply after three minutes");
      setReplyTimedOut(true);
    };
    if (remaining <= 0) {
      markTimedOut();
      return;
    }
    const id = setInterval(
      () => void loadMessages(session.id),
      AWAITING_POLL_MS,
    );
    const stop = setTimeout(() => {
      clearInterval(id);
      markTimedOut();
    }, remaining);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [
    awaiting,
    session,
    deliveryNotice,
    awaitingSince,
    loadMessages,
    pollingChatEnabled,
  ]);
  // Activity rows arrive without a chat reply, so they are not covered by the
  // reply poll above. loadMessages drops stale responses by generation, so an
  // overlap with that poll is harmless. Nobody is reading a hidden tab, and the
  // query behind each tick is not cheap, so pause while the tab is hidden and
  // refetch once on the way back.
  useEffect(() => {
    if (!session || !activityRowsEnabled) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined) {
        id = setInterval(() => void loadMessages(session.id), ACTIVITY_POLL_MS);
      }
    };
    const stop = () => {
      if (id !== undefined) clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return stop();
      // Catch up on whatever happened while hidden instead of waiting 5s.
      void loadMessages(session.id);
      start();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [session, activityRowsEnabled, loadMessages]);
  // Poll delivery availability while an idle chat has no faster reply or
  // activity poll, including a catch-up as soon as a hidden tab returns.
  useEffect(() => {
    if (!session || !pollingChatEnabled || awaiting || activityRowsEnabled) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined) {
        id = setInterval(
          () => void loadMessages(session.id),
          CHAT_AVAILABILITY_POLL_MS,
        );
      }
    };
    const stop = () => {
      if (id !== undefined) clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return stop();
      void loadMessages(session.id);
      start();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [
    activityRowsEnabled,
    awaiting,
    loadMessages,
    pollingChatEnabled,
    session,
  ]);
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
        const isOpenSessionEvent =
          currentSessionId !== null &&
          (payload?.sessionId === currentSessionId ||
            (activityRowsEnabled &&
              payload?.agentId &&
              payload.agentId === selectedIdRef.current));
        if (isOpenSessionEvent) {
          void loadMessages(currentSessionId);
          // Open-chat recency: always bump locally; the flag only controls
          // sort display. Avoids a second /api/agents/owned fetch per message.
          const agentId = selectedIdRef.current;
          if (agentId) {
            const now = new Date().toISOString();
            setAgents((prev) => bumpRosterChatRecency(prev, agentId, now));
          }
          return;
        }
        // A message in a thread this person is not looking at: the roster
        // carries the unread count, so it is the roster that has to refresh.
        const myGen = ++rosterGenRef.current;
        void loadAgents()
          .then((loaded) => {
            if (myGen === rosterGenRef.current) setAgents(loaded);
          })
          .catch(() => {
            // A missed refresh only delays the badge to the next visit.
          });
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
  }, [currentUser.id, loadMessages, loadAgents, activityRowsEnabled, liveSortEnabled]);
  const selectedAgent = useMemo(
    () => (agents ?? []).find((a) => a.id === selectedId) ?? null,
    [agents, selectedId],
  );
  const isExternal = selectedAgent?.runtimeType === "EXTERNAL";
  // Flag + phone + a real agent open: hide app chrome and use AI chat controls.
  const mobileFullscreenChrome = Boolean(
    mobileFullscreenFlag && isMbl && selectedAgent,
  );
  const reuseAiComposer = Boolean(mobileFullscreenFlag && isMbl);
  const dictationProjectId = useMemo(
    () =>
      isMbl && (mobileLayoutEnabled || mobileFullscreenFlag)
        ? agentDictationProjectId(selectedAgent, teamId)
        : null,
    [isMbl, mobileLayoutEnabled, mobileFullscreenFlag, selectedAgent, teamId],
  );
  useEffect(() => {
    setAgentChatMobileFullscreen(mobileFullscreenChrome);
    return () => setAgentChatMobileFullscreen(false);
  }, [mobileFullscreenChrome, setAgentChatMobileFullscreen]);
  useEffect(() => {
    if (!mobileLayoutEnabled || !isMbl || mobileFullscreenChrome) return;
    setMobileTopBarTitle(selectedAgent?.displayName ?? "Agents");
    return () => setMobileTopBarTitle(null);
  }, [
    mobileLayoutEnabled,
    isMbl,
    mobileFullscreenChrome,
    selectedAgent?.displayName,
    setMobileTopBarTitle,
  ]);
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
    return sortRosterByActivity(matching, liveSortEnabled);
  }, [agents, search, teamId, teams, liveSortEnabled]);
  // The actual POST, used by both a direct send and a drained queue item.
  // Reads the target session off sessionIdRef (not the `session` state
  // closure) so a queued send drained after the user switched agents can
  // still be safely dropped by the same staleness check a direct send uses.
  const sendMessageText = useCallback(async (text: string, queuedId?: string) => {
    const targetSessionId = sessionIdRef.current;
    const targetAgentId = selectedIdRef.current;
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
    setReplyTimedOut(false);
    // A new message restarts the awaiting-poll bound.
    setAwaitingSince(null);
    setMessages((prev) => [...(prev ?? []), optimistic]);
    sendingRef.current = true;
    setSending(true);
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
        notice?: TChatMessage;
        error?: string;
      };
      if (!res.ok || !data.success || !data.message) {
        throw new Error(data.error ?? "Failed to send message");
      }
      const sentMessage = data.message;
      if (sessionIdRef.current !== targetSessionId) return;
      setMessages((prev) =>
        (prev ?? []).map((m) => (m.id === optimistic.id ? sentMessage : m)),
      );
      // Always record chat recency on send; liveSortEnabled only controls
      // whether the roster sorts by it. Use the agent captured at send start
      // so a chat switch mid-flight cannot bump the wrong row (HTPR-6283).
      if (targetAgentId) {
        setAgents((prev) =>
          bumpRosterChatRecency(
            prev,
            targetAgentId,
            sentMessage.createdAt ?? new Date().toISOString(),
          ),
        );
      }
      // The webhook outbox had no subscriber for chat.message: the agent will
      // never see this message unless its runtime is set up later.
      if (data.delivered === false && !data.notice) setDeliveryNotice(true);
      // The parked notice is the answer: it lands in the thread right away,
      // without waiting for a broadcast that this send can still outrun.
      // Upsert, not append: that broadcast can also win, and the same row
      // would then appear twice.
      const notice = data.notice;
      if (notice) {
        setMessages((prev) => [
          ...(prev ?? []).filter((m) => m.id !== notice.id),
          notice,
        ]);
        setAwaiting(false);
      }
    } catch (e) {
      if (sessionIdRef.current !== targetSessionId) return;
      // Roll the optimistic bubble back and reopen the composer.
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimistic.id));
      if (queuedId) {
        // A drained queue item failing must not free up the next item to
        // fire out of order: put it back at the front and block draining
        // until it's removed. The agent's earlier run is still live, which is
        // why this was queued, so `awaiting` has to stay true or the Stop
        // button and the poll both disappear until a reload.
        blockedQueueIdRef.current = queuedId;
        messageQueueRef.current = [{ id: queuedId, content: text }, ...messageQueueRef.current];
        setQueuedMessages(messageQueueRef.current);
      } else {
        setAwaiting(false);
        setDraft(text);
      }
      toast.error(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      sendingRef.current = false;
      setSending(false);
      // A queued follow-up drains via the `awaiting` effect above: success
      // leaves the ball with the agent (no-op here), and failure reverts the
      // optimistic message, which flips `awaiting` back to false and fires it.
    }
  }, [liveSortEnabled]);
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
    if (!session || !awaiting || stopping) return;
    const targetSessionId = session.id;
    setStopping(true);
    try {
      const res = await fetch(`/api/agent-chat/${targetSessionId}/stop`, { method: "POST" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to stop agent");
      if (sessionIdRef.current !== targetSessionId) return;
      await loadMessages(targetSessionId);
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
    composerEditorRef.current?.commands.clearContent();
    composerRef.current?.focus();
    focusComposer();
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
    mentionSearchGenRef.current += 1;
    setMentionQuery(null);
    setMentionResults([]);
    setMentionIndex(0);
    setMentionLoading(false);
    setMentionLoadError(false);
  };
  // AudioButton's dictation callback. There is no Tiptap editor here, so this
  // mirrors appendDictationToTitle (TaskTitleModal.tsx): append transcript
  // text to the plain-string draft, same append helper.
  const insertDictation = useCallback((transcript: string) => {
    const editor = composerEditorRef.current;
    if (editor) {
      const prefix = editor.getText().trim() ? " " : "";
      editor.chain().focus("end").insertContent(prefix + transcript).run();
      return;
    }
    setDraft((current) => appendTitleDictation(current, transcript));
    composerRef.current?.focus();
  }, []);
  // Detects an in-progress "@mention" ending at the cursor (must start at the
  // beginning of the text or after whitespace, same rule as the composer's
  // other autocomplete-style features).
  const handleComposerChange = (value: string, cursor: number) => {
    setDraft(value);
    // Typing is the one path fast enough to outrun the passive effect that
    // normally mirrors `draft`, and selectAgent reads this ref to decide what
    // to save for the agent being left.
    draftRef.current = value;
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) {
      if (mentionOpen) dismissMention();
      return;
    }
    setMentionStart(cursor - match[1].length - 1);
    setMentionResults([]);
    setMentionIndex(0);
    setMentionLoading(true);
    setMentionLoadError(false);
    setMentionQuery(match[1]);
  };
  // Same endpoint and request shape as the Ctrl+K task search modal
  // (src/components/Modals/commands/searchTasks.tsx).
  useEffect(() => {
    if (mentionQuery === null) return;
    const myGen = ++mentionSearchGenRef.current;
    const projectIds = (mentionProjects as IProject[]).map((p) => p.id);
    if (projectIds.length === 0) {
      setMentionResults((prev) => (prev.length === 0 ? prev : []));
      setMentionIndex(0);
      setMentionLoading(mentionProjectsLoading);
      setMentionLoadError(mentionProjectsLoadError);
      return;
    }
    let active = true;
    setMentionResults((prev) => (prev.length === 0 ? prev : []));
    setMentionIndex(0);
    setMentionLoading(true);
    setMentionLoadError(false);
    const timeout = setTimeout(
      async () => {
        try {
          const res = await axios.post("/api/tasks/searchAll", {
            projectIds,
            ...(mentionQuery.trim()
              ? { searchQuery: mentionQuery.trim() }
              : { mode: "recent" }),
          });
          if (!active || myGen !== mentionSearchGenRef.current) return;
          const results = Array.isArray(res.data) ? res.data : [];
          setMentionResults(results.slice(0, 8));
          setMentionIndex(0);
        } catch {
          if (active && myGen === mentionSearchGenRef.current) {
            setMentionResults([]);
            setMentionLoadError(true);
          }
        } finally {
          if (active && myGen === mentionSearchGenRef.current) {
            setMentionLoading(false);
          }
        }
      },
      mentionQuery.trim() ? 150 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [
    mentionProjects,
    mentionProjectsLoadError,
    mentionProjectsLoading,
    mentionQuery,
  ]);
  const pickMention = (task: ITask) => {
    const ticket = task.ticketNumber ?? `${task.projectId}-${task.uniqueIndex}`;
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(mentionStart + 1 + (mentionQuery?.length ?? 0));
    const inserted = `${before}${ticket} ${after}`;
    setDraft(inserted);
    dismissMention();
    requestAnimationFrame(() => {
      const editor = composerEditorRef.current;
      if (editor) {
        editor.commands.setContent(inserted, { emitUpdate: false });
        editor.commands.focus();
        const pos = Math.min(
          before.length + ticket.length + 2,
          editor.state.doc.content.size,
        );
        editor.commands.setTextSelection(pos);
        return;
      }
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
    // Sending empties the composer, which clears the stored draft through the
    // same write; a failed send puts the text back and re-saves it.
    if (selectedId) writeDraft(currentUser.id, selectedId, draft);
    // Only once the server copy has been folded in: writing before that would
    // push this thread's empty composer over a draft typed on another device.
    const activeSessionId = sessionIdRef.current;
    if (activeSessionId && draftHydratedRef.current === activeSessionId) {
      saveDraftToServer(activeSessionId, draft);
    }
  }, [draft, selectedId, currentUser.id]);
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
        // Don't fire while the user is mid-edit in the composer: an Alt+Arrow
        // meant to move the cursor, or a stray Ctrl+Tab, would yank them to
        // another agent instead. Text merely restored on selection doesn't
        // count -- drafts now survive the switch, so cycling past a saved one
        // costs nothing and blocking on it would disable the shortcut for as
        // long as the draft sits there (HTPR-6005 review). Reads refs (not
        // `draft` directly) so this effect doesn't need to re-run, and re-add
        // the window listener, on every keystroke.
        if (
          document.activeElement === composerRef.current &&
          draftRef.current.trim() !== "" &&
          draftRef.current !== restoredDraftRef.current
        ) {
          return;
        }
        if (
          composerEditorRef.current?.isFocused &&
          draftRef.current.trim() !== "" &&
          draftRef.current !== restoredDraftRef.current
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
    if (isExternal && session && !composerLocked) focusComposer();
  }, [isExternal, session, composerLocked, selectedId]);
  return useAgentChatView({ activeFeedFilter, activityRowsEnabled, agents, appShellRailOn, awaiting, backToRoster, chatStopAndTimeoutEnabled, composerEditorRef, composerLocked, composerRef, createAgent, createAgentError, creatingAgent, currentUser, deliveryMode, deliveryNotice, detailsCollapsed, detailsDialogRef, detailsSheetOpen, dictationProjectId, draft, feedFilter, handleComposerChange, handleComposerKeyDown, handleMessageListScroll, handleOpenFullChat, handleProposalAction, handleSend, handleStop, insertDictation, isDictationProcessing, isExternal, isMbl, isNarrow, isRecording, mentionIndex, mentionLoadError, mentionLoading, mentionOpen, mentionQuery, mentionResults, messageListRef, messages, messagesError, mobileAgentChatViewport, mobileAgentChatViewportEnabled, mobileFullscreenChrome, mobileFullscreenFlag, mobileLayoutEnabled, newAgentName, newAgentToken, openingFullChat, pickMention, pollingChatEnabled, projectIdForPrefix, queuedMessages, removeQueuedMessage, replyTimedOut, reuseAiComposer, roomsEnabled, roster, rosterError, rosterNow, router, scrollMessagesToBottom, search, selectAgent, selectedAgent, selectedId, sending, sessionLoading, setCreateAgentError, setDetailsSheetOpen, setFeedFilter, setIsDictationProcessing, setIsRecording, setMentionIndex, setNewAgentName, setNewAgentToken, setSearch, setShowCreateAgent, setTeamFilter, setTokenCopied, showCreateAgent, showScrollToBottom, stopping, teamId, teams, toggleDetails, tokenCopied, visibleFeed });
};
export default AgentChatClient;
