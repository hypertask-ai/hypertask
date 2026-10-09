"use client";

import { useMobileVisualViewport } from "@/hooks/General/useMobileVisualViewport";
import { useFlag } from "@/hooks/useFlag";
import { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG } from "@/lib/agentRuns/model";
import { type AgentChatActivity, type AgentChatFilter } from "@/lib/agents/chatActivityFeed";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG, HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG, HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG, HTPR_6553_AGENT_CHAT_POLLING_FLAG } from "@/lib/flags/keys";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { ITask } from "@/models/model";
import { agentChatMobileFullscreenAtom, appShellRailAtom, mobileTopBarTitleAtom } from "@/store";
import type { Editor } from "@tiptap/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useContext, useEffect, useRef, useState } from "react";
import type { TAgent } from "../AgentsRegister";
import { IProp, TAgentChatSession, TChatMessage } from "./agentChatTypes";

export function useAgentChatState(props: IProp) {
  const { currentUser, roomsEnabled } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMbl = useContext(MobileViewContext);
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
  const mobileAgentChatViewport = useMobileVisualViewport(isMbl);
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


  const dismissMention = () => {
    mentionSearchGenRef.current += 1;
    setMentionQuery(null);
    setMentionResults([]);
    setMentionIndex(0);
    setMentionLoading(false);
    setMentionLoadError(false);
  };

  return {
    currentUser, roomsEnabled, router, searchParams, isMbl,
    mobileLayoutEnabled, mobileFullscreenFlag, activityRowsEnabled, rosterNow, liveSortEnabled,
    chatStopAndTimeoutEnabled, pollingChatEnabled, appShellRailOn, setMobileTopBarTitle,
    setAgentChatMobileFullscreen, agents, setAgents, rosterError, setRosterError, search, setSearch,
    teamId, setTeamId, selectedId, setSelectedId, mobileAgentChatViewport, session, setSession,
    sessionLoading, setSessionLoading, messages, setMessages, activity, setActivity, feedFilter,
    setFeedFilter, messagesError, setMessagesError, draft, setDraft, isRecording, setIsRecording,
    isDictationProcessing, setIsDictationProcessing, sending, setSending, awaiting, setAwaiting,
    stopping, setStopping, queuedMessages, setQueuedMessages, messageQueueRef, blockedQueueIdRef,
    deliveryNotice, setDeliveryNotice, deliveryMode, setDeliveryMode, awaitingSince,
    setAwaitingSince, replyTimedOut, setReplyTimedOut, detailsCollapsed, setDetailsCollapsed,
    detailsSheetOpen, setDetailsSheetOpen, detailsDialogRef, isNarrow, setIsNarrow, openingFullChat,
    setOpeningFullChat, messageListRef, showScrollToBottom, setShowScrollToBottom, showCreateAgent,
    setShowCreateAgent, newAgentName, setNewAgentName, creatingAgent, setCreatingAgent,
    createAgentError, setCreateAgentError, newAgentToken, setNewAgentToken, tokenCopied,
    setTokenCopied, mentionQuery, setMentionQuery, mentionStart, setMentionStart, mentionResults,
    setMentionResults, mentionIndex, setMentionIndex, mentionLoading, setMentionLoading,
    mentionLoadError, setMentionLoadError, mentionOpen, selectedIdRef, sessionIdRef, sendingRef,
    awaitingRef, draftRef, restoredDraftRef, loadGenRef, draftHydratedRef, composerRef,
    composerEditorRef, focusComposer, rosterGenRef, mentionSearchGenRef, dismissMention,
  };
}
