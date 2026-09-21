"use client";

import { PROMPT_MAX, healthDotClass, healthLabel } from "./AgentActivityFeed";
import { renderAgentConfigForm } from "./AgentConfigForm";
import { TActivityItem } from "./AgentRunHistory";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRecoilValue } from "@/lib/state";
import { appShellRailAtom } from "@/store";
import { IUser } from "@/models/model";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import toast from "react-hot-toast";
import { isWorking } from "@/lib/agents/registerView";
import { connectRealtimeClient, releaseRealtimeClientIfIdle } from "@/lib/realtime/client";
import { BOARD_EVENT, boardChannel } from "@/lib/realtime/shared";
import type { TAgent } from "../AgentsRegister";
import type { AgentRuntimeHealth, AgentRuntimeQueueItem, AgentRuntimeSnapshot } from "@/lib/agents/runtimeState";
import type { TAgentBoardAccess } from "@/lib/agents/boardAccess";
import { applySequencedError, applySequencedResponse, invalidateSequencedResponse } from "@/lib/agents/responseSequence";

type TAgentOperations = {
  source: "runtime" | "inferred";
  health: AgentRuntimeHealth;
  snapshot: AgentRuntimeSnapshot | null;
  queue: AgentRuntimeQueueItem[];
  sourceBreakdown: Array<{
    boardId: number;
    section: string;
    eligible: number;
  }>;
  counts: {
    sourceTotal: number | null;
    eligiblePool: number | null;
    workerQueue: number;
    assigned: number;
    unowned: number;
    specialistOwned: number;
    processedUnowned: number;
    directMentions: number;
  };
};

type TDetailAgent = TAgent & {
  operations: TAgentOperations;
  boardAccess: TAgentBoardAccess[];
};
// Same cadence as the register, so the two surfaces agree about what an agent
// is doing rather than one lagging the other by minutes.
const POLL_MS = 30_000;

interface IProp {
  agentId: string;
  currentUser: IUser;
  // Embedded inside another surface (Agent Chat details pane): the fixed
  // global rail would overlay the host layout there, and the screen-height
  // root would fight the host's scrolling container.
  embedded?: boolean;
}

const AgentDetail = (props: IProp) => {
  const { agentId, currentUser, embedded } = props;
  const isMbl = useContext(MobileViewContext);
  const railEnabled = useRecoilValue(appShellRailAtom);
  const appShellRailOn = !embedded && railEnabled && !isMbl;
  const router = useRouter();

  const [agent, setAgent] = useState<TDetailAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<TActivityItem[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  // A native agent can carry its own provider key, so its turns bill that
  // provider account instead of the team's shared key (HTPR-5389).
  const [providerKey, setProviderKey] = useState<{
    provider: string;
    maskedKey: string | null;
  } | null>(null);
  const [providerKeyLoaded, setProviderKeyLoaded] = useState(false);
  const [confirmTeamVisibility, setConfirmTeamVisibility] = useState(false);
  const [editingProviderKey, setEditingProviderKey] = useState(false);
  const [providerKeyDraft, setProviderKeyDraft] = useState("");
  const [savingProviderKey, setSavingProviderKey] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [visibilityNotice, setVisibilityNotice] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [boardAccessOpen, setBoardAccessOpen] = useState(false);
  const [pendingBoardId, setPendingBoardId] = useState<number | null>(null);
  const [boardErrors, setBoardErrors] = useState<Record<number, string>>({});
  const [boardToRemove, setBoardToRemove] = useState<TAgentBoardAccess | null>(
    null,
  );
  const [manageOpen, setManageOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [savingImportant, setSavingImportant] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const responseSeq = useRef(0);
  const latestResponseSeq = useRef(new Map<string, number>());
  const bootstrappedAgentId = useRef<string | null>(null);
  const renderedAgentIdentity = useRef<{ id: string; slug: string | null } | null>(
    null,
  );
  const agentRouteRef = useRef(agentId);

  useLayoutEffect(() => {
    agentRouteRef.current = agentId;
  }, [agentId]);

  useEffect(() => {
    renderedAgentIdentity.current = agent
      ? { id: agent.id, slug: agent.slug ?? null }
      : null;
  }, [agent?.id, agent?.slug]);

  const applyResponse = useCallback(
    (seq: number, keys: string[], apply: () => void) =>
      applySequencedResponse(latestResponseSeq.current, seq, keys, apply),
    [],
  );
  const applyError = useCallback(
    (seq: number, keys: string[], apply: () => void) =>
      applySequencedError(latestResponseSeq.current, seq, keys, apply),
    [],
  );

  const fetchAgentRefresh = useCallback(
    async ({
      requestRef,
      mergeRuntime,
      expectedAgentId,
      cancelled = () => false,
      reportError = false,
      onApplied,
    }: {
      requestRef: string;
      mergeRuntime: boolean;
      expectedAgentId?: string;
      cancelled?: () => boolean;
      reportError?: boolean;
      onApplied?: (refreshedAgent: TDetailAgent) => void;
    }) => {
      const seq = ++responseSeq.current;
      const responseKeys = [`agent:${requestRef}`];
      if (expectedAgentId) responseKeys.push(`agent:${expectedAgentId}`);
      try {
        const res = await fetch(`/api/agents/${requestRef}`);
        const data = (await res.json()) as {
          success?: boolean;
          agent?: TDetailAgent;
          error?: string;
        };
        if (!res.ok || !data.success || !data.agent) {
          throw new Error(data.error ?? "Failed to load agent");
        }
        if (cancelled()) return true;
        const refreshedAgent = data.agent;
        if (
          refreshedAgent.id !== requestRef &&
          refreshedAgent.slug !== requestRef
        ) {
          return false;
        }
        if (expectedAgentId && refreshedAgent.id !== expectedAgentId)
          return true;
        const currentRoute = agentRouteRef.current;
        if (
          refreshedAgent.id !== currentRoute &&
          refreshedAgent.slug !== currentRoute
        ) {
          return true;
        }
        responseKeys.push(`agent:${refreshedAgent.id}`);
        if (refreshedAgent.slug) {
          responseKeys.push(`agent:${refreshedAgent.slug}`);
        }
        applyResponse(seq, responseKeys, () => {
          setError(null);
          setAgent((prev) => {
            if (prev && prev.id !== refreshedAgent.id) return prev;
            if (!mergeRuntime || !prev) return refreshedAgent;
            const {
              working,
              heartbeatAt,
              lastPostedAt,
              operations,
              boards,
              boardAccess,
            } = refreshedAgent;
            return {
              ...prev,
              working: working ?? null,
              heartbeatAt,
              lastPostedAt,
              operations,
              boards,
              boardAccess,
            };
          });
          onApplied?.(refreshedAgent);
        });
        return true;
      } catch (e) {
        if (cancelled()) return false;
        const identity = renderedAgentIdentity.current;
        const currentRoute = agentRouteRef.current;
        const requestIsCurrent =
          currentRoute === requestRef ||
          (identity != null &&
            (identity.id === currentRoute || identity.slug === currentRoute) &&
            (identity.id === requestRef || identity.slug === requestRef));
        if (reportError && requestIsCurrent) {
          applyError(seq, responseKeys, () => {
            setError(e instanceof Error ? e.message : "Failed to load agent");
          });
        }
        return false;
      }
    },
    [applyError, applyResponse],
  );

  const loadActivity = useCallback(
    async (refreshedAgent: TDetailAgent) => {
      const seq = ++responseSeq.current;
      const responseKey = `activity:${refreshedAgent.id}`;
      invalidateSequencedResponse(latestResponseSeq.current, seq, [
        responseKey,
      ]);
      try {
        const res = await fetch(
          `/api/agents/${refreshedAgent.id}/activity?limit=40`,
        );
        const data = (await res.json()) as {
          success?: boolean;
          items?: TActivityItem[];
          error?: string;
        };
        if (!res.ok || !data.success || !Array.isArray(data.items)) {
          throw new Error(data.error ?? "Failed to load activity");
        }
        const currentRoute = agentRouteRef.current;
        if (
          refreshedAgent.id !== currentRoute &&
          refreshedAgent.slug !== currentRoute
        ) {
          return false;
        }
        return applyResponse(seq, [responseKey], () => {
          setActivity(data.items ?? []);
          setActivityError(null);
        });
      } catch (e) {
        const currentRoute = agentRouteRef.current;
        if (
          refreshedAgent.id !== currentRoute &&
          refreshedAgent.slug !== currentRoute
        ) {
          return false;
        }
        applyError(seq, [responseKey], () => {
          setActivityError(
            e instanceof Error ? e.message : "Failed to load activity",
          );
        });
        return false;
      }
    },
    [applyError, applyResponse],
  );

  const bootstrapAgent = useCallback(
    (refreshedAgent: TDetailAgent) => {
      if (
        refreshedAgent.slug &&
        refreshedAgent.slug !== agentRouteRef.current
      ) {
        router.replace(`/agents/${refreshedAgent.slug}`, { scroll: false });
      }
      if (bootstrappedAgentId.current === refreshedAgent.id) return;
      void loadActivity(refreshedAgent).then((loaded) => {
        if (loaded) bootstrappedAgentId.current = refreshedAgent.id;
      });
    },
    [loadActivity, router],
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Native turns and an external agent's own Hyper AI calls both run on
  // Hypertask credentials, so every agent can carry a key of its own.
  const loadedAgentId = agent?.id;
  useEffect(() => {
    if (!loadedAgentId) return;
    let cancelled = false;
    setProviderKey(null);
    setProviderKeyLoaded(false);
    fetch(`/api/agents/${loadedAgentId}/provider-key`)
      .then((res) => res.json())
      .then(
        (data: {
          keys?: {
            provider: string;
            enabled?: boolean;
            maskedKey: string | null;
          }[];
        }) => {
        if (cancelled) return;
        // A disabled key resolves to the team credential, so the row has to
        // read "Team key" rather than show a key that is not in use.
        const row = data?.keys?.find(
          (k) => k.provider === "openrouter" && k.enabled !== false,
        );
        setProviderKey(row ?? null);
        setProviderKeyLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setProviderKeyLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadedAgentId]);

  useEffect(() => {
    let cancelled = false;
    const renderedAgent = renderedAgentIdentity.current;
    const changesAgent =
      !renderedAgent ||
      (renderedAgent.id !== agentId && renderedAgent.slug !== agentId);
    if (changesAgent) {
      bootstrappedAgentId.current = null;
      if (renderedAgent) {
        invalidateSequencedResponse(
          latestResponseSeq.current,
          ++responseSeq.current,
          [`activity:${renderedAgent.id}`],
        );
      }
      setActivity(null);
      setActivityError(null);
    }
    setError(null);
    setAgent((prev) =>
      prev && prev.id !== agentId && prev.slug !== agentId ? null : prev,
    );

    void fetchAgentRefresh({
      requestRef: agentId,
      mergeRuntime: false,
      cancelled: () => cancelled,
      reportError: true,
      onApplied: bootstrapAgent,
    });

    // Canonical runtime and membership fields are merged rather than replacing
    // the agent: a poll landing between an edit and its save would otherwise
    // throw the edit away.
    const poll = setInterval(() => {
      void fetchAgentRefresh({
        requestRef: agentId,
        mergeRuntime: true,
        cancelled: () => cancelled,
        onApplied: bootstrapAgent,
      });
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [agentId, bootstrapAgent, fetchAgentRefresh]);

  // The poll above bounds staleness at 30s, but an assignment broadcasts a
  // board change event, so the assigned-ticket count can move the moment it
  // happens instead of on the next tick.
  const subscribedAgentId = agent?.id;
  const boardIdsKey = (agent?.boards ?? []).map((b) => b.id).join(",");
  const boardRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const boardIds = boardIdsKey
      ? boardIdsKey.split(",").map(Number).filter(Boolean)
      : [];
    if (boardIds.length === 0) return;
    let cancelled = false;
    let unsubs: Array<() => void> = [];

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      // Trailing debounce: bulk edits fire one event per ticket, so wait for
      // the burst to settle and fetch once. A failed fetch is left to the
      // poll above rather than retried into a loop.
      const scheduleRefresh = () => {
        if (boardRefreshTimer.current) clearTimeout(boardRefreshTimer.current);
        boardRefreshTimer.current = setTimeout(() => {
          boardRefreshTimer.current = null;
          void fetchAgentRefresh({
            requestRef: agentId,
            mergeRuntime: true,
            expectedAgentId: subscribedAgentId,
            cancelled: () => cancelled,
          });
        }, 500);
      };

      unsubs = boardIds.map((boardId) => {
        const channelName = boardChannel(boardId);
        const channel = client.subscribe(channelName);
        const onBoardEvent = () => scheduleRefresh();
        channel.bind(BOARD_EVENT, onBoardEvent);
        return () => {
          channel.unbind(BOARD_EVENT, onBoardEvent);
          client.unsubscribe(channelName);
        };
      });
      unsubs.push(() => releaseRealtimeClientIfIdle(client));
    })();

    return () => {
      cancelled = true;
      if (boardRefreshTimer.current) {
        clearTimeout(boardRefreshTimer.current);
        boardRefreshTimer.current = null;
      }
      unsubs.forEach((fn) => fn());
    };
  }, [boardIdsKey, agentId, subscribedAgentId, fetchAgentRefresh]);

  const handleSaveProviderKey = async () => {
    const next = providerKeyDraft.trim();
    if (!agent || savingProviderKey || savingVisibility) return;
    if (!next) {
      setEditingProviderKey(false);
      return;
    }
    setSavingProviderKey(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/provider-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "openrouter", apiKey: next }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        maskedKey?: string;
      };
      if (!res.ok || !data.success) return;
      setProviderKey({
        provider: "openrouter",
        maskedKey: data.maskedKey ?? null,
      });
      setProviderKeyDraft("");
      setEditingProviderKey(false);
      setVisibilityNotice(null);
    } catch {
      // leave the field open so the pasted key is not lost
    } finally {
      setSavingProviderKey(false);
    }
  };

  const handleRemoveProviderKey = async () => {
    if (!agent || savingProviderKey || savingVisibility) return;
    setSavingProviderKey(true);
    try {
      const res = await fetch(
        `/api/agents/${agent.id}/provider-key?provider=openrouter`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        visibility?: "PRIVATE" | "TEAM";
        visibilityChanged?: boolean;
      } | null;
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error ?? "Could not remove provider key");
      }
      setProviderKey(null);
      if (data?.visibility) {
        setAgent((current) =>
          current ? { ...current, visibility: data.visibility! } : current,
        );
      }
      setVisibilityNotice(
        data?.visibilityChanged
          ? {
              kind: "success",
              text: "Provider key removed. This agent is now private.",
            }
          : null,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove provider key",
      );
    } finally {
      setSavingProviderKey(false);
    }
  };

  const patchAgent = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      success?: boolean;
      agent?: Partial<TAgent>;
      error?: string;
    };
    if (!res.ok || !data.success || !data.agent) {
      throw new Error(data.error ?? "Failed to update agent");
    }
    return data.agent;
  };

  const handleToggle = async () => {
    if (!agent || togglePending) return;
    setTogglePending(true);
    const wasRevoked = agent.revokedAt;
    setAgent({
      ...agent,
      revokedAt: wasRevoked ? null : new Date().toISOString(),
      // Turning an agent off destroys its key server-side, so the Access block
      // must not keep showing one that no longer works.
      mcpToken: wasRevoked ? agent.mcpToken : null,
      hasMcpToken: wasRevoked ? agent.hasMcpToken : false,
    });
    try {
      // The request states the wanted result rather than asking for a flip, so
      // this page and an open register tab cannot cancel each other out.
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoked: !wasRevoked }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to update agent");
      }
      // Re-enabling an external agent mints a fresh key and reveals it in this
      // one response. Dropping it is not fatal (the key is stored, and can be
      // regenerated) but it is the only time the value can be read, so keep it.
      if (data.token) {
        setAgent((prev) =>
          prev ? { ...prev, mcpToken: data.token, hasMcpToken: true } : prev,
        );
      }
    } catch {
      // Roll back everything the optimistic update touched, not just the
      // switch: leaving the key fields cleared reports "no key" for an agent
      // whose key is still live, and the obvious next move is to regenerate,
      // which breaks the runtime that was authenticating fine.
      setAgent((prev) =>
        prev
          ? {
              ...prev,
              revokedAt: wasRevoked,
              mcpToken: agent.mcpToken,
              hasMcpToken: agent.hasMcpToken,
            }
          : prev,
      );
    } finally {
      setTogglePending(false);
    }
  };

  // Talking to a native agent means a chat session pointed at it. The manage
  // modal opened one the same way; this page replaced that modal, so it has to
  // keep the door open or native agents become unreachable.
  const handleOpenChat = async () => {
    if (openingChat) return;
    setOpeningChat(true);
    try {
      const res = await fetch("/api/ai-chat/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent?.id ?? agentId }),
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
      setOpeningChat(false);
    }
  };

  const handleGenerateToken = async () => {
    if (!agent || tokenBusy) return;
    setTokenBusy(true);
    try {
      const res = await fetch(`/api/agents/${agent?.id ?? agentId}/mcp-token`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        success?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.success || !data.token) {
        throw new Error(data.error ?? "Failed to generate token");
      }
      setAgent((prev) =>
        prev ? { ...prev, mcpToken: data.token, hasMcpToken: true } : prev,
      );
      toast.success("Token generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate token");
    } finally {
      setTokenBusy(false);
    }
  };

  const handleRevokeToken = async () => {
    if (!agent || tokenBusy) return;
    if (
      !confirm(
        "Revoke this key? Anything connecting with it loses access immediately.",
      )
    ) {
      return;
    }
    setTokenBusy(true);
    try {
      const res = await fetch(`/api/agents/${agent?.id ?? agentId}/mcp-token`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to revoke token");
      }
      setAgent((prev) =>
        prev ? { ...prev, mcpToken: null, hasMcpToken: false } : prev,
      );
      toast.success("Key revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke key");
    } finally {
      setTokenBusy(false);
    }
  };

  const handleSaveName = async () => {
    const next = nameDraft.trim();
    // The route rejects an empty name, so do not send one; closing on an empty
    // draft would look like a rename that silently did nothing.
    if (!agent || !next || next === agent.displayName) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const updated = await patchAgent({ displayName: next });
      // The slug follows the name, so the URL has to follow the slug or the
      // address bar keeps pointing at a name this agent no longer has.
      setAgent((prev) =>
        prev
          ? {
              ...prev,
              displayName: updated.displayName ?? next,
              slug: updated.slug ?? prev.slug,
            }
          : prev,
      );
      if (updated.slug && updated.slug !== agentId) {
        router.replace(`/agents/${updated.slug}`, { scroll: false });
      }
      setEditingName(false);
    } catch {
      // leave the field open so the typed name is not lost
    } finally {
      setSavingName(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!agent || promptDraft.length > PROMPT_MAX) return;
    setSavingPrompt(true);
    try {
      // The route trims and nulls an empty prompt, so mirror what it actually
      // stored rather than the raw (possibly untrimmed) draft.
      const updated = await patchAgent({ prompt: promptDraft });
      setAgent((prev) =>
        prev ? { ...prev, prompt: updated.prompt ?? null } : prev,
      );
      setEditingPrompt(false);
    } catch {
      // leave the textarea open so the edit isn't lost
    } finally {
      setSavingPrompt(false);
    }
  };

  // Two writes in flight can land out of order and leave the agent pinned to
  // the model that was picked first, so the picker waits for its own write.
  const handleModelChange = async (value: string) => {
    if (!agent || savingModel) return;
    const prevModelOptionId = agent.modelOptionId;
    setSavingModel(true);
    setAgent({ ...agent, modelOptionId: value || null });
    try {
      await patchAgent({ modelOptionId: value || null });
    } catch {
      setAgent((prev) =>
        prev ? { ...prev, modelOptionId: prevModelOptionId } : prev,
      );
    } finally {
      setSavingModel(false);
    }
  };

  const saveVisibility = async (visibility: "PRIVATE" | "TEAM") => {
    if (!agent || savingVisibility || savingProviderKey) return;

    setSavingVisibility(true);
    setVisibilityNotice(null);
    try {
      const updated = await patchAgent({ visibility });
      const savedVisibility =
        updated.visibility === "TEAM" ? "TEAM" : "PRIVATE";
      setAgent((current) =>
        current ? { ...current, visibility: savedVisibility } : current,
      );
    } catch (error) {
      setVisibilityNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Could not change visibility",
      });
    } finally {
      setSavingVisibility(false);
    }
  };

  const handleVisibilityChange = (value: string) => {
    if (
      !agent ||
      savingVisibility ||
      savingProviderKey ||
      (value !== "PRIVATE" && value !== "TEAM") ||
      value === agent.visibility
    ) {
      return;
    }
    if (value === "TEAM" && agent.runtimeType === "NATIVE" && !providerKey) {
      setConfirmTeamVisibility(true);
      return;
    }
    void saveVisibility(value);
  };

  // The inbox-routing rule the create/edit modal has always carried. It is
  // enforced server-side in getAll.ts; without a control here the agent page
  // would show every other setting and silently hide this one.
  const handleImportantToggle = async () => {
    if (!agent || savingImportant) return;
    const next = agent.postsToImportant === false;
    setSavingImportant(true);
    setAgent((prev) => (prev ? { ...prev, postsToImportant: next } : prev));
    try {
      await patchAgent({ postsToImportant: next });
    } catch (e) {
      setAgent((prev) => (prev ? { ...prev, postsToImportant: !next } : prev));
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingImportant(false);
    }
  };

  const changeBoardMembership = async (
    board: TAgentBoardAccess,
    member: boolean,
  ) => {
    if (!agent || pendingBoardId !== null) return;
    setPendingBoardId(board.id);
    let failureMessage = "Could not change board access";
    setBoardErrors((errors) => {
      const next = { ...errors };
      delete next[board.id];
      return next;
    });
    try {
      const res = await fetch(
        member ? "/api/members/addAgent" : "/api/members/removeAgent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: board.id, agentId: agent.id }),
        },
      );
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        failureMessage = data.message ?? failureMessage;
        throw new Error(failureMessage);
      }
      const refreshed = await fetchAgentRefresh({
        requestRef: agent.id,
        mergeRuntime: false,
        expectedAgentId: agent.id,
      });
      if (!refreshed) {
        setBoardErrors((errors) => ({
          ...errors,
          [board.id]: "Access changed. Reload this page to refresh the list.",
        }));
      }
      toast.success(
        member
          ? `${agent.displayName} added to ${board.name}`
          : `${agent.displayName} removed from ${board.name}`,
      );
    } catch {
      setBoardErrors((errors) => ({
        ...errors,
        [board.id]: failureMessage,
      }));
    } finally {
      setBoardToRemove(null);
      setPendingBoardId(null);
    }
  };

  const handleArchiveToggle = async () => {
    if (!agent || archiving) return;
    const archiving_ = !agent.archivedAt;
    setArchiving(true);
    try {
      const updated = await patchAgent({ archived: archiving_ });
      setAgent((prev) =>
        prev ? { ...prev, archivedAt: updated.archivedAt ?? null } : prev,
      );
      toast.success(archiving_ ? "Agent archived" : "Agent restored");
      // An archived agent is out of the register, so staying on its page after
      // filing it away leaves you looking at something you just hid.
      if (archiving_) router.push("/agents?active=archived");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not archive agent");
    } finally {
      setArchiving(false);
    }
  };

  const handleDelete = async () => {
    if (!agent || deleting) return;
    if (
      !confirm(
        `Delete ${agent.displayName} for good? Its board memberships and task assignments go with it. Comments it posted stay. This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to delete agent");
      }
      toast.success("Agent deleted");
      router.push("/agents");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete agent");
      setDeleting(false);
    }
  };

  // Same expiry rule the register uses, so a page left open stops spinning at
  // the same moment the grid does.
  const working = agent && isWorking(agent) ? agent.working : null;
  const runtimeQueue = agent?.operations.queue ?? [];
  const runtimeActive = runtimeQueue.find((item) =>
    ["running", "waiting"].includes(item.state),
  );
  const pendingQueue = runtimeQueue.filter((item) => item.state === "pending");
  const activeWork = runtimeActive
    ? runtimeActive
    : working
      ? {
          ticket: working.ticket,
          title: working.title,
          url: working.url,
          boardName: agent?.boards?.[0]?.name ?? "Board",
          section: "In Progress",
          startedAt: working.since,
        }
      : null;
  const visiblePending = pendingQueue.slice(0, isMbl ? 2 : 3);
  const runtimeSnapshot = agent?.operations.snapshot;
  const operationsHealth = agent?.operations.health ?? "offline";
  const workingNowLabel = runtimeActive
    ? healthLabel[operationsHealth]
    : working
      ? "Working"
      : healthLabel[operationsHealth];
  const workingNowDot = runtimeActive
    ? healthDotClass[operationsHealth]
    : working
      ? "bg-hypertasks-green"
      : healthDotClass[operationsHealth];
  return renderAgentConfigForm({ activeWork, activity, activityError, agent, agentId, appShellRailOn, archiving, boardAccessOpen, boardErrors, boardToRemove, changeBoardMembership, confirmTeamVisibility, currentUser, deleting, editingName, editingPrompt, editingProviderKey, embedded, error, handleArchiveToggle, handleDelete, handleGenerateToken, handleImportantToggle, handleModelChange, handleOpenChat, handleRemoveProviderKey, handleRevokeToken, handleSaveName, handleSavePrompt, handleSaveProviderKey, handleToggle, handleVisibilityChange, manageOpen, nameDraft, now, openingChat, operationsHealth, pendingBoardId, pendingQueue, promptDraft, providerKey, providerKeyDraft, providerKeyLoaded, runtimeSnapshot, saveVisibility, savingImportant, savingModel, savingName, savingPrompt, savingProviderKey, savingVisibility, setBoardAccessOpen, setBoardToRemove, setConfirmTeamVisibility, setEditingName, setEditingPrompt, setEditingProviderKey, setManageOpen, setNameDraft, setPromptDraft, setProviderKeyDraft, togglePending, tokenBusy, visibilityNotice, visiblePending, working, workingNowDot, workingNowLabel });
};

export default AgentDetail;
