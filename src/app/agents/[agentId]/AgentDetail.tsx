/* eslint-disable @next/next/no-img-element */
"use client";

import { useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRecoilValue } from "@/lib/state";
import { appShellRailAtom } from "@/store";
import { IUser } from "@/models/model";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { aiModelOptions, getAiModelOptionById } from "@/lib/aiModelOptions";
import toast from "react-hot-toast";
import { canPinModelOption } from "@/lib/nativeAgent/modelPin";
import { cn } from "@/utils/undoActions/helperFuncs";
import AgentSelect, { AgentOption } from "../AgentSelect";
import WorkingSpinner from "../WorkingSpinner";
import { isWorking } from "@/lib/agents/registerView";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { BOARD_EVENT, boardChannel } from "@/lib/realtime/shared";
import type { TAgent } from "../AgentsRegister";
import type {
  AgentRuntimeHealth,
  AgentRuntimeQueueItem,
  AgentRuntimeSnapshot,
} from "@/lib/agents/runtimeState";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import type { TAgentBoardAccess } from "@/lib/agents/boardAccess";

type TActivityKind = "comment" | "evidence" | "question" | "session" | "model";

type TActivityItem = {
  id: string;
  at: string;
  kind: TActivityKind;
  did: string;
  detail: string | null;
  task: { id: number; title: string; url: string } | null;
  tokens: number | null;
};

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

const PROMPT_MAX = 8000;
const PROMPT_WARN = 7000;
// Same cadence as the register, so the two surfaces agree about what an agent
// is doing rather than one lagging the other by minutes.
const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function elapsedSince(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const healthLabel: Record<AgentRuntimeHealth, string> = {
  working: "Working",
  connected: "Connected",
  waiting: "Waiting",
  stalled: "Stalled",
  offline: "Offline",
};

const healthDotClass: Record<AgentRuntimeHealth, string> = {
  working: "bg-hypertasks-green",
  connected: "bg-hypertasks-green",
  waiting: "bg-amber-400",
  stalled: "bg-red-400",
  offline: "bg-gray-500",
};

const queueReasonLabel = {
  direct_mention: "Direct mention",
  assignment: "Assigned",
  discovery: "Discovery candidate",
  other: "Queued",
} as const;

// Must read the same two signals the register card reads, or the same agent
// reports "Running" on the grid and "Quiet" on its own page.
function statusWord(agent: TAgent): string {
  if (agent.revokedAt) return "Off";
  const last = [agent.heartbeatAt, agent.lastPostedAt].filter(
    (t): t is string => Boolean(t),
  );
  const latest =
    last.length > 0 ? last.reduce((a, b) => (b > a ? b : a)) : null;
  if (latest && Date.now() - new Date(latest).getTime() < 24 * 60 * 60 * 1000) {
    return "Running";
  }
  return "Quiet";
}

const statusDotClass: Record<string, string> = {
  Running: "bg-green-500",
  Quiet: "bg-gray-400",
  Off: "bg-gray-500 opacity-50",
};

function AgentSwitch({
  on,
  displayName,
  onToggle,
  pending,
  ariaLabel,
}: {
  on: boolean;
  displayName: string;
  onToggle: () => void;
  pending: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={
        ariaLabel ?? (on ? `Turn off ${displayName}` : `Turn on ${displayName}`)
      }
      aria-pressed={on}
      disabled={pending}
      onClick={onToggle}
      className={cn(
        "relative w-[30px] h-[17px] rounded-full shrink-0 transition-colors",
        on ? "bg-hypertasks-purple" : "bg-hoverCardBackground",
        pending && "opacity-60",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] w-[13px] h-[13px] rounded-full bg-white transition-transform",
          on && "translate-x-[13px]",
        )}
      />
    </button>
  );
}

function AgentAvatar({ agent, size }: { agent: TAgent; size: number }) {
  if (agent.photoURL) {
    return (
      <img
        src={agent.photoURL}
        alt=""
        style={{ width: size, height: size }}
        className="rounded-full shrink-0 object-cover"
      />
    );
  }
  const initials = agent.displayName.slice(0, 2).toUpperCase();
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full shrink-0 bg-hoverCardBackground flex items-center justify-center text-[13px] font-medium text-white-black"
    >
      {initials}
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline text-[13px]">
      <span className="w-[27%] shrink-0 text-text-light-gray font-medium">
        {label}
      </span>
      <span className="ml-[14px] min-w-0">{children}</span>
    </div>
  );
}

function RecentActionsCard({
  activity,
  error,
}: {
  activity: TActivityItem[] | null;
  error: string | null;
}) {
  return (
    <div className="mt-3 bg-cardBackground rounded-[4px] p-4 shadow-md overflow-x-auto">
      <h2 className="font-semibold mb-2">Recent actions</h2>
      {error && <p className="text-[13px] text-red-500">{error}</p>}
      {!error && !activity && (
        <p className="text-[13px] text-text-light-gray">Loading activity…</p>
      )}
      {!error && activity?.length === 0 && (
        <p className="text-[13px] text-text-light-gray">No activity yet.</p>
      )}
      {!error && activity && activity.length > 0 && (
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr>
              {['When', 'Did', 'Where', 'Tokens'].map((heading) => (
                <th
                  key={heading}
                  className="text-[12px] uppercase text-text-light-gray font-medium pb-2 pr-3"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activity.map((item) => (
              <tr
                key={item.id}
                className="border-t border-comment-description-border"
              >
                <td className="text-[13px] py-2 pr-3 whitespace-nowrap text-text-light-gray">
                  {timeAgo(item.at)}
                </td>
                <td className="text-[13px] py-2 pr-3">
                  <div>{item.did}</div>
                  {item.detail && (
                    <div className="text-[12px] text-text-light-gray truncate max-w-[280px]">
                      {item.detail}
                    </div>
                  )}
                </td>
                <td className="text-[13px] py-2 pr-3 max-w-[180px]">
                  {item.task ? (
                    <Link
                      href={item.task.url}
                      className="text-hypertasks-purple truncate block"
                    >
                      {item.task.title}
                    </Link>
                  ) : (
                    <span className="text-text-light-gray">—</span>
                  )}
                </td>
                <td className="text-[13px] py-2">
                  {item.tokens != null ? (
                    formatTokens(item.tokens)
                  ) : (
                    <span className="text-text-light-gray">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface IProp {
  agentId: string;
  currentUser: IUser;
}

const AgentDetail = (props: IProp) => {
  const { agentId, currentUser } = props;
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
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
  const [editingProviderKey, setEditingProviderKey] = useState(false);
  const [providerKeyDraft, setProviderKeyDraft] = useState("");
  const [savingProviderKey, setSavingProviderKey] = useState(false);
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
      })
      .catch(() => {
        // the row falls back to "Team key", which is what an unset key means
      });
    return () => {
      cancelled = true;
    };
  }, [loadedAgentId]);

  useEffect(() => {
    let cancelled = false;

    // Nested routes take the uuid, not the slug, so activity runs on the id
    // the agent load resolved.
    const loadActivity = (id: string) =>
      fetch(`/api/agents/${id}/activity?limit=40`)
        .then(async (res) => {
          const data = (await res.json()) as {
            success?: boolean;
            items?: TActivityItem[];
            error?: string;
          };
          if (!res.ok || !data.success || !Array.isArray(data.items)) {
            throw new Error(data.error ?? "Failed to load activity");
          }
          if (!cancelled) setActivity(data.items);
        })
        .catch((e) => {
          if (!cancelled) {
            setActivityError(
              e instanceof Error ? e.message : "Failed to load activity",
            );
          }
        });

    fetch(`/api/agents/${agentId}`)
      .then(async (res) => {
        const data = (await res.json()) as {
          success?: boolean;
          agent?: TDetailAgent;
          error?: string;
        };
        if (!res.ok || !data.success || !data.agent) {
          throw new Error(data.error ?? "Failed to load agent");
        }
        if (cancelled) return;
        setAgent(data.agent);
        // A link built on an id still works; the address bar shows the
        // readable form instead of a uuid.
        if (data.agent.slug && data.agent.slug !== agentId) {
          router.replace(`/agents/${data.agent.slug}`, { scroll: false });
        }
        loadActivity(data.agent.id);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load agent");
        }
      });

    // Only the live fields are re-read, and they are merged rather than
    // replacing the agent: a poll landing between an edit and its save would
    // otherwise throw the edit away.
    const poll = setInterval(() => {
      fetch(`/api/agents/${agentId}`)
        .then(async (res) => {
          const data = (await res.json()) as {
            success?: boolean;
            agent?: TDetailAgent;
          };
          if (!res.ok || !data.success || !data.agent) return;
          if (cancelled) return;
          const { working, heartbeatAt, lastPostedAt, operations } = data.agent;
          setAgent((prev) =>
            prev
              ? {
                  ...prev,
                  working: working ?? null,
                  heartbeatAt,
                  lastPostedAt,
                  operations,
                }
              : prev,
          );
        })
        .catch(() => {});
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [agentId, router]);

  // The poll above bounds staleness at 30s, but an assignment broadcasts a
  // board change event, so the assigned-ticket count can move the moment it
  // happens instead of on the next tick.
  const boardIdsKey = (agent?.boards ?? []).map((b) => b.id).join(",");
  const boardRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRefreshSeq = useRef(0);
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
          const seq = ++latestRefreshSeq.current;
          fetch(`/api/agents/${agentId}`)
            .then(async (res) => {
              const data = (await res.json()) as {
                success?: boolean;
                agent?: TDetailAgent;
              };
              if (!res.ok || !data.success || !data.agent) return;
              // Only the newest request may merge, or a slow earlier
              // response would overwrite a newer count.
              if (seq !== latestRefreshSeq.current || cancelled) return;
              const { working, heartbeatAt, lastPostedAt, operations } =
                data.agent;
              setAgent((prev) =>
                prev
                  ? {
                      ...prev,
                      working: working ?? null,
                      heartbeatAt,
                      lastPostedAt,
                      operations,
                    }
                  : prev,
              );
            })
            .catch(() => {});
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
  }, [boardIdsKey, agentId]);

  const handleSaveProviderKey = async () => {
    const next = providerKeyDraft.trim();
    if (!agent || savingProviderKey) return;
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
    } catch {
      // leave the field open so the pasted key is not lost
    } finally {
      setSavingProviderKey(false);
    }
  };

  const handleRemoveProviderKey = async () => {
    if (!agent || savingProviderKey) return;
    setSavingProviderKey(true);
    try {
      const res = await fetch(
        `/api/agents/${agent.id}/provider-key?provider=openrouter`,
        { method: "DELETE" },
      );
      if (res.ok) setProviderKey(null);
    } catch {
      // keep the current value; the next load re-reads the truth
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
      const refresh = await fetch(`/api/agents/${agent.id}`);
      const refreshed = (await refresh.json().catch(() => null)) as {
        success?: boolean;
        agent?: TDetailAgent;
      } | null;
      if (refresh.ok && refreshed?.success && refreshed.agent) {
        setAgent(refreshed.agent);
      } else {
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

  const content = (
    <div className="min-h-screen bg-pageBackground text-white-black text-[14px]">
      <div className="max-w-[1120px] mx-auto px-6 py-7">
        <Link
          href="/agents"
          className="text-[13px] text-text-light-gray hover:text-white-black"
        >
          ← Agents
        </Link>

        {error && <p className="mt-6 text-[13px] text-red-500">{error}</p>}
        {!error && !agent && (
          <p className="mt-6 text-[13px] text-text-light-gray">
            Loading agent…
          </p>
        )}

        {!error && agent && (
          <>
            <div className="mt-4 flex items-center gap-3">
              <AgentAvatar agent={agent} size={34} />
              {working ? (
                <WorkingSpinner label={`${agent.displayName} is working now`} />
              ) : (
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    statusDotClass[statusWord(agent)],
                  )}
                />
              )}
              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => void handleSaveName()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  disabled={savingName}
                  aria-label="Agent name"
                  // Borderless, like every other input here: the house style is
                  // no boxes, and the field already reads as the title it edits.
                  className="text-[20px] font-semibold bg-transparent outline-none min-w-0 flex-1"
                />
              ) : (
                <h1
                  className="text-[20px] font-semibold truncate cursor-text"
                  title="Click to rename"
                  onClick={() => {
                    setNameDraft(agent.displayName);
                    setEditingName(true);
                  }}
                >
                  {agent.displayName}
                </h1>
              )}
              <span className="flex-1" />
              {/* The two actions the manage modal used to carry: a native
                  agent is talked to in chat, an external one reports through
                  its inbox. Same split as the modal's row buttons. */}
              {agent.runtimeType === "NATIVE" ? (
                <button
                  type="button"
                  disabled={openingChat}
                  onClick={() => void handleOpenChat()}
                  className="text-[13px] text-hypertasks-purple disabled:opacity-50"
                >
                  {openingChat ? "Opening…" : "Chat"}
                </button>
              ) : (
                <Link
                  href={`/inbox/agent/${agent.id}`}
                  className="text-[13px] text-hypertasks-purple"
                >
                  Inbox
                </Link>
              )}
              <span className="text-[13px] text-text-light-gray">
                {working ? "Working" : statusWord(agent)}
              </span>
              <span
                className="text-[13px] text-text-light-gray"
                title="Tickets currently assigned to this agent"
              >
                {agent.operations.counts.assigned} assigned ticket
                {agent.operations.counts.assigned === 1 ? "" : "s"}
              </span>
              <AgentSwitch
                on={!agent.revokedAt}
                displayName={agent.displayName}
                onToggle={() => void handleToggle()}
                pending={togglePending}
              />
            </div>

            <div className="mt-6 grid grid-cols-1 lg:[grid-template-columns:1fr_300px] gap-5 items-start">
              <div>
                <section className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="font-semibold">Working now</h2>
                    <span className="flex items-center gap-1.5 text-[13px] font-medium">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          workingNowDot,
                        )}
                      />
                      {workingNowLabel}
                    </span>
                    <span className="ml-auto text-[12px] text-text-light-gray">
                      {activeWork
                        ? `${elapsedSince(activeWork.startedAt, now)} elapsed`
                        : "No active ticket"}
                    </span>
                  </div>
                  {activeWork ? (
                    <>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <Link
                          href={activeWork.url}
                          className="text-hypertasks-purple whitespace-nowrap"
                        >
                          {activeWork.ticket}
                        </Link>
                        <strong className="text-[16px]">{activeWork.title}</strong>
                      </div>
                      <p className="mt-1 text-[13px] text-text-light-gray">
                        {activeWork.boardName} · {activeWork.section || "Current stage"}
                        {agent.operations.source === "inferred" &&
                          " · inferred from board"}
                      </p>
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          [runtimeSnapshot?.runtime ?? "Unreported", "runtime"],
                          [runtimeSnapshot?.model ?? "Unreported", "model"],
                          [
                            runtimeSnapshot?.heartbeatAt
                              ? `${elapsedSince(runtimeSnapshot.heartbeatAt, now)} ago`
                              : "Never",
                            "heartbeat",
                          ],
                          [
                            runtimeSnapshot?.lastProgressAt
                              ? `${elapsedSince(runtimeSnapshot.lastProgressAt, now)} ago`
                              : "Unreported",
                            "last progress",
                          ],
                        ].map(([value, label]) => (
                          <div
                            key={label}
                            className="bg-newcomment-well rounded-[4px] px-3 py-2 min-w-0"
                          >
                            <strong className="block truncate">{value}</strong>
                            <span className="text-[12px] text-text-light-gray">
                              {label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="mt-2 text-[13px] text-text-light-gray">
                      {agent.operations.source === "runtime"
                        ? "The worker reports no active ticket."
                        : "No active ticket is visible. This status is inferred from the board."}
                    </p>
                  )}
                </section>

                <section className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                  <div className="flex items-baseline gap-2 mb-3">
                    <h2 className="font-semibold">Queue</h2>
                    <span className="ml-auto text-[12px] text-text-light-gray">
                      {agent.operations.source === "runtime"
                        ? "actual worker order"
                        : "inferred from board"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-comment-description-border rounded-[4px] overflow-hidden">
                    {[
                      [
                        agent.operations.counts.eligiblePool ?? "—",
                        "scoped pool",
                      ],
                      [agent.operations.counts.workerQueue, "worker queue"],
                      [agent.operations.counts.assigned, "assigned"],
                      [agent.operations.counts.unowned, "unowned"],
                      [agent.operations.counts.specialistOwned, "specialist-owned"],
                      [agent.operations.counts.directMentions, "direct mentions"],
                    ].map(([value, label]) => (
                      <div key={label} className="bg-newcomment-well px-3 py-2.5">
                        <strong className="block text-[18px] font-semibold">
                          {value}
                        </strong>
                        <span className="text-[12px] text-text-light-gray">
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                  {agent.operations.sourceBreakdown.length > 0 && (
                    <p className="mt-2 text-[12px] text-text-light-gray">
                      {agent.operations.sourceBreakdown
                        .map(({ section, eligible }) => `${section} ${eligible}`)
                        .join(" · ")}
                    </p>
                  )}
                  <p className="mt-2 text-[12px] text-text-light-gray">
                    The scoped pool counts only work this agent can pick up: in
                    its labels and columns, and not owned by another agent. It is
                    discovery input, not automatically its queue.
                  </p>
                </section>

                <section className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className="font-semibold">Up next</h2>
                    <span className="ml-auto text-[12px] text-text-light-gray">
                      {pendingQueue.length} pending
                    </span>
                  </div>
                  {visiblePending.length === 0 ? (
                    <p className="mt-2 text-[13px] text-text-light-gray">
                      No queued tickets reported.
                    </p>
                  ) : (
                    <div className="mt-1">
                      {visiblePending.map((item, index) => (
                        <div
                          key={`${item.ticket}-${index}`}
                          className="grid grid-cols-[22px_minmax(0,1fr)] md:grid-cols-[22px_minmax(0,1fr)_150px_80px] gap-x-2 gap-y-1 items-baseline py-2.5 border-t border-comment-description-border first:border-t-0"
                        >
                          <span className="text-text-light-gray">{index + 1}</span>
                          <Link href={item.url} className="min-w-0">
                            <span className="text-hypertasks-purple">
                              {item.ticket}
                            </span>{" "}
                            {item.title}
                          </Link>
                          <span className="col-start-2 md:col-auto text-[12px] text-text-light-gray">
                            {queueReasonLabel[item.reason]}
                            {item.dueAt &&
                              ` · due ${new Date(item.dueAt).toLocaleDateString()}`}
                          </span>
                          <span className="col-start-2 md:col-auto md:text-right text-[12px]">
                            {item.priority ?? "Normal"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {pendingQueue.length > visiblePending.length && (
                    <p className="mt-1 text-[12px] text-text-light-gray">
                      +{pendingQueue.length - visiblePending.length} more in the worker queue
                    </p>
                  )}
                  {(agent.operations.counts.processedUnowned > 0 ||
                    agent.operations.counts.specialistOwned > 0) && (
                    <p className="mt-2 bg-newcomment-well rounded-[4px] px-3 py-2 text-[12px] text-text-light-gray">
                      <strong className="text-white-black">Not queued:</strong>{" "}
                      {agent.operations.counts.processedUnowned > 0 &&
                        `${agent.operations.counts.processedUnowned} unowned ${
                          agent.operations.counts.processedUnowned === 1
                            ? "ticket was"
                            : "tickets were"
                        } already processed but remain in the source column`}
                      {agent.operations.counts.processedUnowned > 0 &&
                        agent.operations.counts.specialistOwned > 0 &&
                        "; "}
                      {agent.operations.counts.specialistOwned > 0 &&
                        `${agent.operations.counts.specialistOwned} ${
                          agent.operations.counts.specialistOwned === 1
                            ? "ticket belongs"
                            : "tickets belong"
                        } to specialist agents`}
                      .
                    </p>
                  )}
                </section>

                {agent.runtimeType === "NATIVE" && (
                  <div className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                    <div className="flex items-center">
                      <h2 className="font-semibold">Instructions</h2>
                      <span className="flex-1" />
                      {!editingPrompt && (
                        <button
                          type="button"
                          className="text-[13px] text-hypertasks-purple"
                          onClick={() => {
                            setPromptDraft(agent.prompt ?? "");
                            setEditingPrompt(true);
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </div>

                    {!editingPrompt ? (
                      <div className="mt-3 bg-newcomment-well rounded-[4px] p-3 text-[13px] whitespace-pre-wrap">
                        {agent.prompt || (
                          <span className="text-text-light-gray">
                            No instructions set
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3">
                        <textarea
                          value={promptDraft}
                          onChange={(e) => setPromptDraft(e.target.value)}
                          rows={8}
                          className="w-full bg-transparent outline-none resize-y text-[13px]"
                        />
                        {promptDraft.length > PROMPT_WARN && (
                          <p
                            className={cn(
                              "mt-1 text-[12px]",
                              promptDraft.length > PROMPT_MAX
                                ? "text-red-500"
                                : "text-text-light-gray",
                            )}
                          >
                            {promptDraft.length} / {PROMPT_MAX}
                          </p>
                        )}
                        <div className="mt-2 flex gap-3">
                          <button
                            type="button"
                            disabled={
                              savingPrompt || promptDraft.length > PROMPT_MAX
                            }
                            onClick={handleSavePrompt}
                            className="text-[13px] text-hypertasks-purple disabled:opacity-50"
                          >
                            {savingPrompt ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPrompt(false)}
                            className="text-[13px] text-text-light-gray"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Native agents run inside Hypertask, and the mint endpoint
                    refuses them, so only external agents get this block. */}
                {agent.runtimeType === "EXTERNAL" && (
                  <div className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                    <h2 className="font-semibold">Access key</h2>
                    <p className="mt-1 text-[13px] text-text-light-gray">
                      Your runtime authenticates with this key. Turning the
                      agent off destroys it.
                    </p>

                    {agent.mcpToken ? (
                      <div className="mt-3">
                        <div className="bg-newcomment-well rounded-[4px] p-3">
                          <code className="text-[12px] break-all">
                            {agent.mcpToken}
                          </code>
                        </div>
                        <div className="mt-2 flex gap-4">
                          <button
                            type="button"
                            className="text-[13px] text-hypertasks-purple"
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                agent.mcpToken ?? "",
                              );
                              toast.success("Key copied");
                            }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            disabled={tokenBusy}
                            className="text-[13px] text-hypertasks-purple disabled:opacity-50"
                            onClick={() => void handleGenerateToken()}
                          >
                            {tokenBusy ? "Working…" : "Regenerate"}
                          </button>
                          <button
                            type="button"
                            disabled={tokenBusy}
                            className="text-[13px] text-text-light-gray disabled:opacity-50"
                            onClick={() => void handleRevokeToken()}
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ) : agent.hasMcpToken ? (
                      /* The routes only ever send the value once, at minting, so
                       an existing key can be replaced or revoked but not read
                       back — saying "no key yet" here would be a lie. */
                      <div className="mt-3">
                        <p className="text-[13px] text-text-light-gray">
                          A key is set. It was shown once when it was created.
                        </p>
                        <div className="mt-2 flex gap-4">
                          <button
                            type="button"
                            disabled={tokenBusy}
                            className="text-[13px] text-hypertasks-purple disabled:opacity-50"
                            onClick={() => void handleGenerateToken()}
                          >
                            {tokenBusy ? "Working…" : "Regenerate"}
                          </button>
                          <button
                            type="button"
                            disabled={tokenBusy}
                            className="text-[13px] text-text-light-gray disabled:opacity-50"
                            onClick={() => void handleRevokeToken()}
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <p className="text-[13px] text-text-light-gray">
                          {agent.revokedAt
                            ? "No key. Turn the agent on, then generate one."
                            : "No key yet."}
                        </p>
                        <button
                          type="button"
                          disabled={tokenBusy || Boolean(agent.revokedAt)}
                          className="mt-2 text-[13px] text-hypertasks-purple disabled:opacity-50"
                          onClick={() => void handleGenerateToken()}
                        >
                          {tokenBusy ? "Generating…" : "Generate a key"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

              </div>

              <div className="flex flex-col gap-3">
                <section className="bg-comment-description rounded-[4px] px-4 py-3 shadow-md flex flex-col gap-1.5">
                  <h2 className="font-semibold mb-1">Runtime health</h2>
                  <InfoRow label="State">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          healthDotClass[operationsHealth],
                        )}
                      />
                      {healthLabel[operationsHealth]}
                    </span>
                  </InfoRow>
                  <InfoRow label="Source">
                    {agent.operations.source === "runtime"
                      ? "Live worker"
                      : "Inferred from board"}
                  </InfoRow>
                  <InfoRow label="Worker">
                    {runtimeSnapshot?.workerId ?? "Not connected"}
                  </InfoRow>
                  <InfoRow label="Heartbeat">
                    {runtimeSnapshot?.heartbeatAt
                      ? `${elapsedSince(runtimeSnapshot.heartbeatAt, now)} ago`
                      : "Never"}
                  </InfoRow>
                  <InfoRow label="Progress">
                    {runtimeSnapshot?.lastProgressAt
                      ? `${elapsedSince(runtimeSnapshot.lastProgressAt, now)} ago`
                      : "Unreported"}
                  </InfoRow>
                </section>

                <section className="bg-comment-description rounded-[4px] px-4 py-3 shadow-md flex flex-col gap-1.5">
                  <h2 className="font-semibold mb-1">Configuration</h2>
                <InfoRow label="Runs on">
                  {agent.runtimeType === "NATIVE"
                    ? "Hypertask · native"
                    : "Your own runtime"}
                </InfoRow>
                {/* Only a native agent's turns run on Hypertask's models, so
                    an external agent gets no picker rather than one that
                    saves and changes nothing. */}
                {agent.runtimeType === "NATIVE" && (
                  <InfoRow label="Model">
                    <AgentSelect
                      value={agent.modelOptionId ?? ""}
                      onChange={handleModelChange}
                      disabled={savingModel}
                      ariaLabel="Model this agent runs on"
                    >
                      <AgentOption value="">Team default</AgentOption>
                      {/* Same list the PATCH route enforces, so the picker can
                        never offer something the API will reject. */}
                      {aiModelOptions
                        .filter((option) => canPinModelOption(option.id))
                        .map((option) => (
                          <AgentOption key={option.id} value={option.id}>
                            {option.title}
                          </AgentOption>
                        ))}
                    </AgentSelect>
                  </InfoRow>
                )}
                {/* Team key by default. Pasting a key here moves this agent's
                    spend onto that provider account, which is what makes its
                    cost an invoice instead of an estimate. */}
                <InfoRow label="Provider key">
                  {editingProviderKey ? (
                    <input
                      autoFocus
                      type="password"
                      value={providerKeyDraft}
                      onChange={(e) => setProviderKeyDraft(e.target.value)}
                      onBlur={() => void handleSaveProviderKey()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSaveProviderKey();
                        if (e.key === "Escape") {
                          setProviderKeyDraft("");
                          setEditingProviderKey(false);
                        }
                      }}
                      disabled={savingProviderKey}
                      placeholder="Paste an OpenRouter key"
                      aria-label="OpenRouter key for this agent"
                      className="bg-transparent outline-none min-w-0 w-[220px]"
                    />
                  ) : (
                    <span
                      className="flex items-center gap-2"
                      data-agent-provider-key
                    >
                      <span
                        className="cursor-text"
                        title="Click to set an OpenRouter key"
                        onClick={() => setEditingProviderKey(true)}
                      >
                        {providerKey?.maskedKey
                          ? `OpenRouter ${providerKey.maskedKey}`
                          : "Team key"}
                      </span>
                      {providerKey?.maskedKey && (
                        <button
                          type="button"
                          disabled={savingProviderKey}
                          className="text-[12px] text-text-light-gray"
                          onClick={() => void handleRemoveProviderKey()}
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  )}
                </InfoRow>
                <InfoRow label="Important">
                  <span className="flex items-center gap-2">
                    <AgentSwitch
                      on={agent.postsToImportant !== false}
                      displayName={agent.displayName}
                      pending={savingImportant}
                      ariaLabel={`Let ${agent.displayName} post to Important`}
                      onToggle={() => void handleImportantToggle()}
                    />
                    <span className="text-text-light-gray">
                      {agent.postsToImportant === false
                        ? "Agents split only"
                        : "Can post"}
                    </span>
                  </span>
                </InfoRow>
                <InfoRow label="Owner">
                  {currentUser.displayName || "You"}
                </InfoRow>
                <InfoRow label="Created">
                  {new Date(agent.createdAt).toLocaleDateString()}
                </InfoRow>
                {agent.runtimeType === "NATIVE" && (
                  <InfoRow label="Heartbeat">
                    {agent.heartbeatAt ? (
                      timeAgo(agent.heartbeatAt)
                    ) : (
                      <span className="text-text-light-gray">Never</span>
                    )}
                  </InfoRow>
                )}
                </section>
              </div>
            </div>

            <RecentActionsCard activity={activity} error={activityError} />

            <div className="mt-6 bg-cardBackground rounded-[4px] shadow-md">
              <button
                type="button"
                aria-expanded={boardAccessOpen}
                onClick={() => setBoardAccessOpen((open) => !open)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
              >
                <span className="text-text-light-gray">
                  {boardAccessOpen ? "▾" : "▸"}
                </span>
                <span>
                  <strong className="block">Board access</strong>
                  <span className="text-[12px] text-text-light-gray">
                    This agent is a member of {agent.boards?.length ?? 0}{" "}
                    {(agent.boards?.length ?? 0) === 1 ? "board" : "boards"}
                  </span>
                </span>
              </button>

              {boardAccessOpen && (
                <div className="border-t border-comment-description-border px-4 pb-2">
                  <p className="py-3 text-[13px] text-text-light-gray">
                    Tick a board to give this agent access. Changes save
                    immediately.
                  </p>
                  {agent.boardAccess.length === 0 ? (
                    <p className="pb-3 text-[13px] text-text-light-gray">
                      No accessible boards.
                    </p>
                  ) : (
                    agent.boardAccess.map((board) => {
                      const pending = pendingBoardId === board.id;
                      const additionBlocked =
                        !board.member && Boolean(agent.revokedAt);
                      return (
                        <div
                          key={board.id}
                          className="flex items-start gap-3 border-t border-comment-description-border py-3 first:border-t-0"
                        >
                          <input
                            type="checkbox"
                            checked={board.member}
                            disabled={
                              pendingBoardId !== null ||
                              !board.canChange ||
                              additionBlocked
                            }
                            aria-label={`${board.member ? "Remove" : "Add"} ${agent.displayName} ${board.member ? "from" : "to"} ${board.name}`}
                            onChange={() => {
                              if (board.member) setBoardToRemove(board);
                              else void changeBoardMembership(board, true);
                            }}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-hypertasks-purple disabled:opacity-40"
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/project?id=${board.id}`}
                              className="text-hypertasks-purple"
                            >
                              {board.name}
                            </Link>
                            <p
                              className={cn(
                                "mt-0.5 text-[12px]",
                                boardErrors[board.id]
                                  ? "text-red-500"
                                  : "text-text-light-gray",
                              )}
                            >
                              {pending
                                ? "Saving..."
                                : boardErrors[board.id] ??
                                  (additionBlocked
                                    ? "Turn the agent on before adding it"
                                    : board.unavailableReason ??
                                      (board.member
                                        ? `Member${board.teamName ? ` · ${board.teamName}` : ""}`
                                        : `Not a member${board.teamName ? ` · ${board.teamName}` : ""}`))}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {boardToRemove && (
              <ConfirmDialog
                id="remove-agent-board-access"
                message={`Remove ${agent.displayName} from ${boardToRemove.name}?`}
                confirmLabel="Remove from board"
                loadingLabel="Removing..."
                loading={pendingBoardId === boardToRemove.id}
                onConfirm={() =>
                  void changeBoardMembership(boardToRemove, false)
                }
                onCancel={() => setBoardToRemove(null)}
                footerVerb="remove"
              >
                <p className="px-4 py-3 text-[13px] text-text-light-gray">
                  The agent will lose access to this board and its content. You
                  can add it again later.
                </p>
              </ConfirmDialog>
            )}

            {/* Collapsed by default: archiving and deleting are the two things
                on this page you cannot undo with the switch next to the name,
                so they do not sit open next to the everyday controls. */}
            <div className="mt-6 bg-cardBackground rounded-[4px] shadow-md">
              <button
                type="button"
                aria-expanded={manageOpen}
                onClick={() => setManageOpen((open) => !open)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
              >
                <span className="text-text-light-gray">
                  {manageOpen ? "▾" : "▸"}
                </span>
                <span className="font-semibold">Archive or delete</span>
                {agent.archivedAt && (
                  <span className="text-[13px] text-text-light-gray">
                    · archived {timeAgo(agent.archivedAt)}
                  </span>
                )}
              </button>

              {manageOpen && (
                <div className="px-4 pb-4 flex flex-col gap-4">
                  <div>
                    <p className="text-[13px] text-text-light-gray">
                      Archiving files the agent away. It keeps its history and
                      its boards, stops showing in the register, and can be
                      restored from the Archived filter at any time.
                    </p>
                    <button
                      type="button"
                      disabled={archiving}
                      onClick={() => void handleArchiveToggle()}
                      className="mt-2 text-[13px] text-hypertasks-purple disabled:opacity-50"
                    >
                      {archiving
                        ? "Working…"
                        : agent.archivedAt
                          ? "Restore agent"
                          : "Archive agent"}
                    </button>
                  </div>

                  <div className="border-t border-comment-description-border pt-4">
                    <p className="text-[13px] text-text-light-gray">
                      Deleting removes the agent, its board memberships and its
                      task assignments for good. Comments it posted stay as
                      history. This cannot be undone.
                    </p>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDelete()}
                      className="mt-2 text-[13px] text-red-500 disabled:opacity-50"
                    >
                      {deleting ? "Deleting…" : "Delete agent"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
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

export default AgentDetail;
