"use client";

import { useMobileVisualViewport } from "@/hooks/General/useMobileVisualViewport";
import { useFlag } from "@/hooks/useFlag";
import { type AgentChatActivity, type AgentChatFilter } from "@/lib/agents/chatActivityFeed";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG, HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG } from "@/lib/flags/keys";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { ITask } from "@/models/model";
import { agentChatMobileFullscreenAtom, appShellRailAtom, mobileTopBarTitleAtom } from "@/store";
import type { Editor } from "@tiptap/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useContext, useEffect, useRef, useState } from "react";
import type { TAgent } from "../AgentsRegister";
import { IProp, TAgentChatSession, TChatMessage } from "./agentChatTypes";
import type { QueuedAgentChatMessage } from "@/lib/agents/chatContext";

export function useAgentChatState(props: IProp) {
  const { currentUser, roomsEnabled, embedded } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMbl = useContext(MobileViewContext);
  const mobileLayoutEnabled = useFlag(HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG);
  const activityRowsEnabled = !embedded;
  const rosterStatusEnabled = useFlag("htpr-6287-agent-chat-roster-status");
  const [rosterNow, setRosterNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rosterStatusEnabled) return;
    const tick = setInterval(() => setRosterNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [rosterStatusEnabled]);
  const liveSortEnabled = useFlag(HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG);
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
  const mobileAgentChatViewport = useMobileVisualViewport(isMbl && !embedded);
  const [session, setSession] = useState<TAgentChatSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [messages, setMessages] = useState<TChatMessage[] | null>(null);
  const [activity, setActivity] = useState<AgentChatActivity[]>([]);
  const [feedFilter, setFeedFilter] = useState<AgentChatFilter>("all");
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isDictationProcessing, setIsDictationProcessing] = useState(false);
  const [sending, setSending] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<
    QueuedAgentChatMessage[]
  >([]);
  const messageQueueRef = useRef<QueuedAgentChatMessage[]>([]);
  const blockedQueueIdRef = useRef<string | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<
    "webhook" | "polling" | null
  >(null);
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
  const messageListRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [createAgentError, setCreateAgentError] = useState<string | null>(null);
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionResults, setMentionResults] = useState<ITask[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionLoadError, setMentionLoadError] = useState(false);
  const mentionOpen = mentionQuery !== null;

  const selectedIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const awaitingRef = useRef(false);
  const draftRef = useRef("");
  const restoredDraftRef = useRef("");
  const loadGenRef = useRef(0);
  const draftHydratedRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerEditorRef = useRef<Editor | null>(null);
  const focusComposer = () => {
    if (composerEditorRef.current) {
      composerEditorRef.current.commands.focus();
      return;
    }
    composerRef.current?.focus();
  };
  const rosterGenRef = useRef(0);
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
    currentUser, roomsEnabled, embedded, router, searchParams, isMbl,
    mobileLayoutEnabled, activityRowsEnabled, rosterNow, liveSortEnabled,
    appShellRailOn, setMobileTopBarTitle,
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
