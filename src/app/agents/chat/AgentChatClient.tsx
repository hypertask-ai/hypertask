/* eslint-disable @next/next/no-img-element */
"use client";

import { AGENT_CHAT_EVENT } from "@/lib/realtime/shared";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useRecoilValue } from "@/lib/state";
import { appShellRailAtom } from "@/store";
import { IUser } from "@/models/model";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { cn } from "@/utils/undoActions/helperFuncs";
import toast from "react-hot-toast";
import { ArrowLeft, ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import { TypingIndicator } from "@/components/AI_CHAT/TypingIndicator";
import { markdownToHtml } from "@/utils/helperFunctions/markdownToHtml";
import { isWorking, statusOf, listTeams } from "@/lib/agents/registerView";
import AgentSelect, { AgentOption } from "../AgentSelect";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { userChannel } from "@/lib/realtime/shared";
import AgentDetail from "../[agentId]/AgentDetail";
import type { TAgent } from "../AgentsRegister";
import AgentAvatar from "@/components/Agents/AgentAvatar";


// While we are waiting for an external agent to answer, the only way to see
// the reply arrive is to keep asking.
const AWAITING_POLL_MS = 4000;
// Realtime still refetches when the reply lands; the interval is only a
// fallback, so stop it after this long waiting on the same session.
const AWAITING_POLL_MAX_MS = 15 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 8000;
const DETAILS_COLLAPSED_KEY = "agentChat.detailsCollapsed";
const TEAM_FILTER_KEY = "agentChat.teamId";

type TChatMessage = {
  id: string;
  role: "human" | "assistant";
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
  "[&_code]:bg-hoverCardBackground [&_code]:rounded-[3px] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] " +
  "[&_pre]:bg-hoverCardBackground [&_pre]:rounded-[4px] [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0";

function MessageBubble({ message }: { message: TChatMessage }) {
  if (message.role === "human") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[4px] bg-hypertasks-purple px-3 py-2 text-[13px] whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }
  // markdownToHtml escapes raw HTML and sanitizes the result, so the string is
  // safe to inject.
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "max-w-[80%] rounded-[4px] bg-cardBackground px-3 py-2 text-[13px]",
          MARKDOWN_CLASS,
        )}
        dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }}
      />
    </div>
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
        <span className="block text-[13px] font-medium truncate">
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

const AgentChatClient = (props: IProp) => {
  const { currentUser } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;

  const [agents, setAgents] = useState<TAgent[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<TAgentChatSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [messages, setMessages] = useState<TChatMessage[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
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

  // Refs mirror the state that async callbacks and event handlers must read
  // without going stale (which chat is on screen, which POST is in flight).
  const selectedIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  // Monotonic request generation for loadMessages, so a late response can be
  // recognized as superseded by a newer one for the same session.
  const loadGenRef = useRef(0);
  // Mobile keyboards only open for a focus() that lands synchronously inside
  // the tap's event handler, so selectAgent needs the composer's DOM node
  // before that handler returns (see the flushSync call there).
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // The roster is owner-scoped and small; one fetch per visit is enough.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/agents/owned");
        const data = (await res.json()) as {
          success?: boolean;
          agents?: TAgent[];
          error?: string;
        };
        if (!res.ok || !data.success || !Array.isArray(data.agents)) {
          throw new Error(data.error ?? "Failed to load agents");
        }
        if (!cancelled) setAgents(data.agents);
      } catch (e) {
        if (!cancelled) {
          setRosterError(
            e instanceof Error ? e.message : "Failed to load agents",
          );
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // The team filter is remembered per browser; default to "All teams".
  useEffect(() => {
    try {
      setTeamId(window.localStorage.getItem(TEAM_FILTER_KEY) || null);
    } catch {
      // Private browsing and hardened policies can reject localStorage.
    }
  }, []);

  const setTeamFilter = (next: string | null) => {
    setTeamId(next);
    try {
      if (next) window.localStorage.setItem(TEAM_FILTER_KEY, next);
      else window.localStorage.removeItem(TEAM_FILTER_KEY);
    } catch {
      // Private browsing and hardened policies can reject localStorage.
    }
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
        error?: string;
        chatEnabled?: boolean;
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
      setMessagesError(null);
      // Same signal a failed send sets: no live webhook subscribed to
      // chat.message, so the human side of the notice must survive a reload.
      if (data.chatEnabled === false) setDeliveryNotice(true);
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
    setMessagesError(null);
    setDeliveryNotice(false);
    setDraft("");
  };

  const selectAgent = useCallback(
    (agent: TAgent) => {
      selectedIdRef.current = agent.id;
      sessionIdRef.current = null;
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
        setMessagesError(null);
        setDeliveryNotice(false);
        setDraft("");
      });
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

  const lastMessage =
    messages && messages.length > 0 ? messages[messages.length - 1] : null;
  // Same definition as the route's `awaiting`: the last message is ours, so
  // the ball is in the agent's court.
  const awaiting = lastMessage?.role === "human";
  // A failed delivery (deliveryNotice) leaves the ball with us: the composer
  // must reopen so the user can send again, and the poll must stay stopped.
  const composerLocked = awaiting && !deliveryNotice;

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
      const onChatEvent = (payload: { sessionId?: string } | undefined) => {
        const eventSessionId =
          (payload as { sessionId?: string } | undefined)?.sessionId ?? null;
        if (eventSessionId && eventSessionId === sessionIdRef.current) {
          void loadMessages(eventSessionId);
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
  }, [currentUser.id, loadMessages]);

  const selectedAgent = useMemo(
    () => (agents ?? []).find((a) => a.id === selectedId) ?? null,
    [agents, selectedId],
  );
  const isExternal = selectedAgent?.runtimeType === "EXTERNAL";

  const teams = useMemo(() => listTeams(agents ?? []), [agents]);

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

  const handleSend = async () => {
    const text = draft.trim();
    if (!session || !text || sendingRef.current) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      toast.error("Message is too long (8000 characters max)");
      return;
    }
    const optimistic: TChatMessage = {
      id: `optimistic-${Date.now()}`,
      role: "human",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setDraft("");
    setDeliveryNotice(false);
    // A new message restarts the 15 minute awaiting-poll bound.
    setAwaitingSince(null);
    setMessages((prev) => [...(prev ?? []), optimistic]);
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await fetch(`/api/agent-chat/${session.id}/messages`, {
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
      if (sessionIdRef.current !== session.id) return;
      setMessages((prev) =>
        (prev ?? []).map((m) => (m.id === optimistic.id ? sentMessage : m)),
      );
      // The webhook outbox had no subscriber for chat.message: the agent will
      // never see this message unless its runtime is set up later.
      if (data.delivered === false) setDeliveryNotice(true);
    } catch (e) {
      if (sessionIdRef.current !== session.id) return;
      // Roll the optimistic bubble back and hand the text back to the user.
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimistic.id));
      setDraft(text);
      toast.error(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

  const rosterPane = (
    <aside
      className={cn(
        "flex flex-col min-h-0",
        isNarrow ? "flex-1" : "w-[300px] shrink-0 border-r border-comment-description-border",
      )}
    >
      <div className="px-3 pt-4 pb-2">
        <h1 className="px-1 text-[16px] font-semibold">Agent Chat</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents"
          aria-label="Search agents"
          className="mt-2 w-full rounded-[4px] bg-cardBackground px-3 py-1.5 text-[13px] outline-none placeholder:text-text-light-gray"
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
          <p className="px-2 py-3 text-[12px] text-red-500">{rosterError}</p>
        )}
        {!rosterError && !agents && (
          <p className="px-2 py-3 text-[12px] text-text-light-gray">
            Loading agents…
          </p>
        )}
        {agents && roster.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-text-light-gray">
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
          <p className="truncate text-[12px] text-text-light-gray">
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
          <p className="max-w-[340px] text-[13px] text-text-light-gray">
            {selectedAgent.displayName} is a Hypertask native agent. Its chat
            lives in the full AI chat surface.
          </p>
          <button
            type="button"
            disabled={openingFullChat}
            onClick={() => void handleOpenFullChat()}
            className="text-[13px] text-hypertasks-purple disabled:opacity-50"
          >
            {openingFullChat ? "Opening…" : "Open full chat"}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
            {messagesError && (
              <p className="text-[12px] text-red-500">{messagesError}</p>
            )}
            {(sessionLoading || (!messages && !messagesError)) && (
              <p className="text-[12px] text-text-light-gray">Loading chat…</p>
            )}
            {messages && messages.length === 0 && (
              <p className="text-[12px] text-text-light-gray">
                Send {selectedAgent.displayName} a message to start the
                conversation.
              </p>
            )}
            {messages?.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {awaiting && !deliveryNotice && (
              <div
                className="flex items-center gap-2 text-[12px] text-text-light-gray"
                role="status"
              >
                <TypingIndicator />
                <span>{selectedAgent.displayName} is working</span>
              </div>
            )}
          </div>
          {/* Card surface under the well: the two tokens differ in every theme, so the box stays visible on AMOLED (well = page) and porcelain (card = page). */}
          <div className="shrink-0 bg-cardBackground px-4 pb-4 pt-1">
            {deliveryNotice && (
              <p className="mb-2 text-[12px] text-text-light-gray">
                This agent&apos;s runtime has not enabled chat yet.
              </p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                rows={2}
                disabled={composerLocked}
                placeholder={
                  composerLocked
                    ? `${selectedAgent.displayName} is working on a reply`
                    : `Message ${selectedAgent.displayName}`
                }
                aria-label={`Message ${selectedAgent.displayName}`}
                className="flex-1 resize-none rounded-[4px] bg-newcomment-well px-3 py-2 text-[13px] outline-none placeholder:text-text-light-gray disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={composerLocked || !draft.trim() || sending}
                className="rounded-[4px] bg-shadcn-primary text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 px-3 py-2 text-[13px] font-medium"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  ) : (
    <section className="flex flex-1 items-center justify-center">
      <p className="text-[13px] text-text-light-gray">
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
            <span className="text-[13px] font-medium text-text-light-gray">
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
      >
        {selectedAgent ? chatPane : rosterPane}
        {detailsSheet}
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
