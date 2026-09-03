/* eslint-disable @next/next/no-img-element */
"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRecoilValue } from "@/lib/state";
import { appShellRailAtom } from "@/store";
import { IUser } from "@/models/model";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { getAiModelOptionById } from "@/lib/aiModelOptions";
import { cn } from "@/utils/undoActions/helperFuncs";
import { IconoirKanban } from "@/components/Common/IconoirIcons";
import { PlugZap } from "lucide-react";
import AgentWebhookPanel from "@/components/Modals/Agent/AgentWebhookPanel";
import AgentSelect, { AgentOption } from "./AgentSelect";
import WorkingSpinner from "./WorkingSpinner";
import {
  agentFiltersToQuery,
  viewAgents,
  defaultAgentFilters,
  filterAgents,
  getAgentPreferenceStorage,
  hasAgentContentFilters,
  listBoards,
  isWorking,
  listTeams,
  readRememberedAgentGrouping,
  resolveAgentFilters,
  statusOf,
  writeRememberedAgentGrouping,
  type TActiveFilter,
  type TAgentGrouping,
  type TAgentFilters,
  type TRegisterBoard,
  type TRegisterWork,
} from "@/lib/agents/registerView";

type TAgentBoard = TRegisterBoard;

type TAgent = {
  id: string;
  // Readable URL segment, derived from the name by the server so the register
  // and the detail route cannot disagree about what a slug points at.
  slug?: string;
  displayName: string;
  photoURL: string | null;
  createdAt: string;
  revokedAt: string | null;
  archivedAt?: string | null;
  // The ticket this agent holds a live lease on, or null when it is idle.
  working?: TRegisterWork | null;
  runtimeType: "NATIVE" | "EXTERNAL";
  prompt: string | null;
  modelOptionId: string | null;
  // Set when this agent runs on its own provider account (HTPR-5389); the
  // server sends only the masked tail, and only to the owner.
  providerKey?: { provider: string; maskedKey: string } | null;
  heartbeatAt: string | null;
  lastPostedAt?: string | null;
  boards?: TAgentBoard[];
  // A key is shown once, when it is minted: the database keeps only its hash,
  // so no route can send it again. The two fields answer different questions:
  // `mcpToken` is a value this session just saw, `hasMcpToken` is what the
  // server says about whether a key exists.
  mcpToken?: string | null;
  hasMcpToken?: boolean;
  // Off keeps everything this agent authors out of Important, mentions of you
  // included. Both agent routes send it; only the detail page edits it.
  postsToImportant?: boolean;
};

// A spinner over data fetched once is an animation telling a lie, so the
// register re-asks. 30s against a 5-minute lease TTL: work shows up within half
// a minute, and a finished agent stops spinning promptly.
const POLL_MS = 30_000;

/** OpenRouter and friends read better than the stored provider slug. */
function providerLabel(provider: string): string {
  return provider === "openrouter"
    ? "OpenRouter"
    : provider === "claude"
      ? "Anthropic"
      : provider.charAt(0).toUpperCase() + provider.slice(1);
}

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

// An action is something the agent did. A heartbeat that found no work is not
// an action, so it only proves the agent is alive.
function lastActionAt(agent: TAgent): string | null {
  return agent.lastPostedAt ?? null;
}

const statusDotClass: Record<ReturnType<typeof statusOf>, string> = {
  running: "bg-green-500",
  quiet: "bg-gray-400",
  off: "bg-gray-500 opacity-50",
};

function AgentSwitch({
  agent,
  onToggle,
  pending,
}: {
  agent: TAgent;
  onToggle: (agent: TAgent) => void;
  pending: boolean;
}) {
  const on = !agent.revokedAt;
  return (
    <button
      type="button"
      aria-label={
        on ? `Turn off ${agent.displayName}` : `Turn on ${agent.displayName}`
      }
      aria-pressed={on}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(agent);
      }}
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
      className="rounded-full shrink-0 bg-hoverCardBackground flex items-center justify-center text-[11px] font-medium text-white-black"
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

export function AgentCard({
  agent,
  onToggle,
  pending,
}: {
  agent: TAgent;
  onToggle: (agent: TAgent) => void;
  pending: boolean;
}) {
  const status = statusOf(agent);
  const working = isWorking(agent) ? agent.working : null;
  const last = lastActionAt(agent);
  const modelTitle = agent.modelOptionId
    ? (getAiModelOptionById(agent.modelOptionId)?.title ?? "Team default")
    : "Team default";
  const description =
    agent.runtimeType === "NATIVE"
      ? agent.prompt?.split("\n")[0]?.trim() || "No instructions set"
      : "External runtime";
  const cardBoards = agent.boards ?? [];
  const [webhookOpen, setWebhookOpen] = useState(false);

  return (
    // A real anchor covers the card, so these pages can be middle-clicked,
    // opened in a new tab and bookmarked. The switch sits above that overlay
    // rather than inside it, since a <button> cannot legally nest in an <a>.
    <div className="relative bg-cardBackground rounded-[4px] p-4 shadow-md hover:bg-hoverCardBackground transition-colors">
      <Link
        href={`/agents/${agent.slug ?? agent.id}`}
        aria-label={`Open ${agent.displayName}`}
        className="absolute inset-0 z-10 rounded-[4px]"
      />
      <div className="flex items-center gap-2">
        <AgentAvatar agent={agent} size={28} />
        {working ? (
          <WorkingSpinner label={`${agent.displayName} is working now`} />
        ) : (
          <span
            className={cn(
              "w-2 h-2 rounded-full shrink-0",
              statusDotClass[status],
            )}
          />
        )}
        <span className="font-semibold text-white-black truncate">
          {agent.displayName}
        </span>
        <span className="flex-1" />
        {agent.runtimeType === "EXTERNAL" && (
          <button
            type="button"
            aria-label={`Configure webhook for ${agent.displayName}`}
            aria-expanded={webhookOpen}
            title="Connect and push events"
            className={cn(
              "relative z-20 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border-0 text-text-light-gray transition-colors hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none",
              webhookOpen && "bg-active-modal-element text-white-black",
            )}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setWebhookOpen((open) => !open);
            }}
          >
            <PlugZap
              strokeWidth={1.75}
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden
            />
          </button>
        )}
        <div className="relative z-20">
          <AgentSwitch agent={agent} onToggle={onToggle} pending={pending} />
        </div>
      </div>

      <p className="mt-2 text-[13px] text-text-light-gray truncate">
        {description}
      </p>

      <div className="mt-3 flex flex-col gap-1.5">
        {working && (
          // Text, not a link: the whole card is already an anchor to the agent,
          // and a second anchor inside it would have to fight that overlay.
          <InfoRow label="Working on">
            <span className="truncate block">
              <span className="text-text-light-gray">{working.ticket}</span>{" "}
              {working.title}
            </span>
          </InfoRow>
        )}
        <InfoRow label="Runs on">
          {agent.runtimeType === "NATIVE"
            ? "Hypertask · native"
            : "Your own runtime"}
        </InfoRow>
        {agent.runtimeType === "NATIVE" && (
          <InfoRow label="Model">{modelTitle}</InfoRow>
        )}
        <InfoRow label="Provider key">
          <span data-agent-provider-key>
            {agent.providerKey
              ? `${providerLabel(agent.providerKey.provider)} ${agent.providerKey.maskedKey}`
              : "Team key"}
          </span>
        </InfoRow>
        <InfoRow label="Last action">
          {last ? (
            timeAgo(last)
          ) : agent.heartbeatAt ? (
            <span className="text-text-light-gray">
              Nothing yet · checked in {timeAgo(agent.heartbeatAt)}
            </span>
          ) : (
            <span className="text-text-light-gray">No activity yet</span>
          )}
        </InfoRow>
        <InfoRow label="Boards">
          {cardBoards.length > 0 ? (
            // The board glyph, not the bare name: a board can be named after
            // the agent that works it ("AB Test Concept Agent"), and without
            // the glyph the row reads as the agent's own name repeated back.
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {cardBoards.map((board) => (
                <span
                  key={board.id}
                  className="flex items-center gap-1 min-w-0"
                >
                  <IconoirKanban
                    size={13}
                    strokeWidth={1.5}
                    className="shrink-0 text-icon-dark-gray"
                  />
                  <span className="truncate">{board.name}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="text-text-light-gray">None</span>
          )}
        </InfoRow>
      </div>
      {webhookOpen && (
        <div className="relative z-20 -mx-4 -mb-4 mt-4">
          <AgentWebhookPanel agent={agent} />
        </div>
      )}
    </div>
  );
}

function FilterBar({
  filters,
  teams,
  boards,
  onChange,
}: {
  filters: TAgentFilters;
  teams: { id: string; name: string }[];
  boards: { id: number; name: string }[];
  onChange: (next: TAgentFilters) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
      {/* Shown from one team up: the filter was asked for by name, and hiding
          it whenever a user happens to have a single team makes it look
          missing. Zero teams means no board carries one, so there is nothing
          to pick. */}
      {teams.length > 0 && (
        <label className="flex items-center gap-2">
          <span className="text-text-light-gray">Team</span>
          <AgentSelect
            value={filters.teamId ?? ""}
            ariaLabel="Filter agents by team"
            // Boards belong to teams, so narrowing the team invalidates any
            // board already chosen.
            onChange={(teamId) =>
              onChange({ ...filters, teamId: teamId || null, boardId: null })
            }
          >
            <AgentOption value="">All teams</AgentOption>
            {teams.map((team) => (
              <AgentOption key={team.id} value={team.id}>
                {team.name}
              </AgentOption>
            ))}
          </AgentSelect>
        </label>
      )}
      {boards.length > 1 && (
        <label className="flex items-center gap-2">
          <span className="text-text-light-gray">Board</span>
          <AgentSelect
            value={filters.boardId ? String(filters.boardId) : ""}
            ariaLabel="Filter agents by board"
            onChange={(boardId) =>
              onChange({ ...filters, boardId: Number(boardId) || null })
            }
          >
            <AgentOption value="">All boards</AgentOption>
            {boards.map((board) => (
              <AgentOption key={board.id} value={String(board.id)}>
                {board.name}
              </AgentOption>
            ))}
          </AgentSelect>
        </label>
      )}
      <label className="flex items-center gap-2">
        <span className="text-text-light-gray">Show</span>
        <AgentSelect
          value={filters.active}
          ariaLabel="Filter agents by whether they are switched on"
          onChange={(active) =>
            onChange({ ...filters, active: active as TActiveFilter })
          }
        >
          <AgentOption value="all">All agents</AgentOption>
          <AgentOption value="on">Active only</AgentOption>
          <AgentOption value="off">Switched off</AgentOption>
          <AgentOption value="archived">Archived</AgentOption>
        </AgentSelect>
      </label>
      <label className="flex items-center gap-2">
        <span className="text-text-light-gray">Sort</span>
        <AgentSelect
          value={filters.group}
          ariaLabel="Group agents by board, or list them by latest activity"
          onChange={(group) =>
            onChange({ ...filters, group: group as TAgentGrouping })
          }
        >
          <AgentOption value="board">By board</AgentOption>
          <AgentOption value="none">Latest activity</AgentOption>
        </AgentSelect>
      </label>
    </div>
  );
}

interface IProp {
  currentUser: IUser;
}

const AgentsRegister = (props: IProp) => {
  const { currentUser } = props;
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [agents, setAgents] = useState<TAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rememberedGrouping, setRememberedGrouping] =
    useState<TAgentGrouping | null>(null);

  useEffect(() => {
    setRememberedGrouping(
      readRememberedAgentGrouping(
        getAgentPreferenceStorage(window),
        currentUser.id,
      ),
    );
  }, [currentUser.id]);

  const inFlightToggles = useRef<Set<string>>(new Set());
  // Bumped on every toggle edge. A poll that started before a toggle and lands
  // after it finished would pass the in-flight check and write pre-PATCH state
  // back, so the switch flicks back a moment after you set it.
  const toggleGeneration = useRef(0);
  const loadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // A refetch mid-toggle would overwrite the optimistic switch with the
      // state the server had before the PATCH landed, and the switch would
      // visibly flick back.
      if (inFlightToggles.current.size > 0) return;
      const generation = toggleGeneration.current;
      try {
        // Owner-scoped, so this lists every agent across every team. The
        // sibling /api/agents needs a teamId and would show one arbitrary team.
        const res = await fetch("/api/agents/owned");
        const data = (await res.json()) as {
          success?: boolean;
          agents?: TAgent[];
          error?: string;
        };
        if (!res.ok || !data.success || !Array.isArray(data.agents)) {
          throw new Error(data.error ?? "Failed to load agents");
        }
        // Rechecked after the await, not only before it: a request already in
        // flight when a toggle starts would otherwise land afterwards and
        // overwrite the optimistic switch with pre-PATCH state. The generation
        // covers the toggle that both starts and finishes inside this await,
        // which leaves the pending set empty again.
        if (
          !cancelled &&
          inFlightToggles.current.size === 0 &&
          generation === toggleGeneration.current
        ) {
          loadedOnce.current = true;
          // A poll that recovers has to take the error screen down with it,
          // or the register stays blank over data it now has.
          setError(null);
          setAgents(data.agents);
        }
      } catch (e) {
        // A poll that fails must not blank a register that is already on
        // screen; the next tick usually succeeds.
        if (!cancelled && !loadedOnce.current) {
          setError(e instanceof Error ? e.message : "Failed to load agents");
        }
      }
    }

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentUser.id]);

  // Each request states the wanted result, so a second click cannot undo the
  // first. The pending set still stops this tab from firing two at once.
  const [pendingToggle, setPendingToggle] = useState<Set<string>>(new Set());
  const markPending = (id: string, pending: boolean) => {
    toggleGeneration.current += 1;
    if (pending) inFlightToggles.current.add(id);
    else inFlightToggles.current.delete(id);
    setPendingToggle((prev) => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleToggle = (agent: TAgent) => {
    if (pendingToggle.has(agent.id)) return;
    markPending(agent.id, true);
    setAgents((prev) =>
      prev
        ? prev.map((a) =>
            a.id === agent.id
              ? {
                  ...a,
                  revokedAt: a.revokedAt ? null : new Date().toISOString(),
                }
              : a,
          )
        : prev,
    );

    fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revoked: !agent.revokedAt }),
    })
      .then(async (res) => {
        const data = (await res.json()) as { success?: boolean };
        if (!res.ok || !data.success) throw new Error("Failed to update agent");
      })
      .catch(() => {
        // revert on failure
        setAgents((prev) =>
          prev ? prev.map((a) => (a.id === agent.id ? agent : a)) : prev,
        );
      })
      .finally(() => markPending(agent.id, false));
  };

  // Running/Quiet is a question about the clock, not only about the data, so
  // a page left open has to re-ask it or an agent stays under Running long
  // after its last check-in aged out.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Filters live in the URL, so a filtered register is a link you can keep or
  // send, and the palette can open one directly (Disabled agents -> ?active=off).
  // A URL without a grouping restores this account's last Sort choice.
  const filters = useMemo(
    () => resolveAgentFilters(searchParams, rememberedGrouping),
    [searchParams, rememberedGrouping],
  );
  const setFilters = (next: TAgentFilters) => {
    if (next.group !== filters.group) {
      writeRememberedAgentGrouping(
        getAgentPreferenceStorage(window),
        currentUser.id,
        next.group,
      );
      setRememberedGrouping(next.group);
    }
    // Once the user interacts, keep the resulting URL deterministic for
    // sharing. Bare /agents remains the preference-restoring entry point.
    const preserveDefaultGrouping = next.group === "board";
    router.replace(
      `/agents${agentFiltersToQuery(next, { preserveDefaultGrouping })}`,
      { scroll: false },
    );
  };

  const teams = useMemo(() => listTeams(agents ?? []), [agents]);
  const boards = useMemo(
    () => listBoards(agents ?? [], filters.teamId),
    [agents, filters.teamId],
  );

  const clusters = useMemo(() => {
    return viewAgents(agents ?? [], filters);
    // clockTick: the status dot and the "x min ago" strings both read the
    // clock, so a page left open has to re-render as time passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, filters, clockTick]);

  // Archived agents are out of every count for the same reason they are out of
  // every view: "50 agents" over 47 cards is the register contradicting itself.
  const total = (agents ?? []).filter((a) => !a.archivedAt).length;
  const shown = useMemo(
    () => filterAgents(agents ?? [], filters).length,
    [agents, filters],
  );
  // An agent holding a lease is running whatever the heartbeat clock says, or
  // the header would read "0 running" over a card that is visibly spinning.
  const runningCount = useMemo(
    () =>
      (agents ?? []).filter(
        (a) => !a.archivedAt && (isWorking(a) || statusOf(a) === "running"),
      ).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents, clockTick],
  );
  const filtered = hasAgentContentFilters(filters);

  const content = (
    <div className="min-h-screen bg-pageBackground text-white-black text-[14px]">
      <div className="max-w-[1120px] mx-auto px-6 py-7">
        <h1 className="text-[22px] font-semibold">Agents</h1>
        {agents && (
          <p className="mt-1 text-[13px] text-text-light-gray">
            {/* The count has to describe what is on screen, or it contradicts
                the cards as soon as a filter is on. */}
            {filters.active === "archived"
              ? `${shown} archived agent${shown === 1 ? "" : "s"}`
              : filtered
                ? `${shown} of ${total} agent${total === 1 ? "" : "s"}`
                : `${total} agent${total === 1 ? "" : "s"} · ${runningCount} running`}
          </p>
        )}

        {agents && agents.length > 0 && (
          <FilterBar
            filters={filters}
            teams={teams}
            boards={boards}
            onChange={setFilters}
          />
        )}

        {error && <p className="mt-6 text-[13px] text-red-500">{error}</p>}

        {!error && !agents && (
          <p className="mt-6 text-[13px] text-text-light-gray">
            Loading agents…
          </p>
        )}

        {!error && agents && agents.length === 0 && (
          <p className="mt-6 text-[13px] text-text-light-gray">
            No agents yet.
          </p>
        )}

        {!error && agents && agents.length > 0 && clusters.length === 0 && (
          <p className="mt-6 text-[13px] text-text-light-gray">
            No agents match this filter.
          </p>
        )}

        {!error && agents && clusters.length > 0 && (
          <div className="mt-6 flex flex-col gap-7">
            {clusters.map((cluster) => (
              <div key={cluster.board?.id ?? "no-board"}>
                {filters.group === "board" && (
                  <h2 className="text-[13px] font-medium text-text-light-gray mb-3">
                    {cluster.board ? (
                      <Link
                        href={`/project?id=${cluster.board.id}`}
                        className="inline-flex items-center gap-1.5 align-middle hover:text-white-black"
                      >
                        <IconoirKanban size={13} strokeWidth={1.5} />
                        {cluster.board.name}
                      </Link>
                    ) : (
                      "No board"
                    )}
                    <span className="ml-2 text-text-light-gray">
                      {cluster.agents.length}
                    </span>
                  </h2>
                )}
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
                  {cluster.agents.map((agent) => (
                    <AgentCard
                      // An agent works on several boards, so the id alone is
                      // not unique across clusters.
                      key={`${cluster.board?.id ?? "none"}-${agent.id}`}
                      agent={agent}
                      pending={pendingToggle.has(agent.id)}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
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

export default AgentsRegister;
export type { TAgent };
