/**
 * How the agents register turns a flat list of agents into what you see:
 * which ones a filter keeps, and which board cluster each one lands in.
 *
 * Kept out of the component so the rules can be tested directly. A multi-board
 * agent and a board-less one are the two cases that break naive grouping, and
 * both are covered in tests/agents-register-view.test.cjs.
 */

export type TRegisterBoard = {
  id: number;
  name: string;
  teamId: string | null;
  teamName: string | null;
};

export type TRegisterWork = {
  ticket: string;
  title: string;
  url: string;
  since: string;
  expiresAt: string;
};

export type TRegisterAgent = {
  id: string;
  displayName: string;
  revokedAt: string | null;
  archivedAt?: string | null;
  heartbeatAt: string | null;
  lastPostedAt?: string | null;
  working?: TRegisterWork | null;
  boards?: TRegisterBoard[];
};

/**
 * Whether to spin the card's indicator. The lease's own expiry decides, not the
 * fact that a `working` object was once fetched: a page left open would
 * otherwise keep spinning over an agent that stopped ten minutes ago.
 */
export function isWorking(agent: TRegisterAgent, now = Date.now()): boolean {
  if (!agent.working) return false;
  return new Date(agent.working.expiresAt).getTime() > now;
}

/** How recently an agent has to have checked in to read as running. */
export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type TAgentStatus = "running" | "quiet" | "off";

/** Off means the owner switched it off. Everything else is about the clock. */
export function statusOf(
  agent: TRegisterAgent,
  now = Date.now(),
): TAgentStatus {
  if (agent.revokedAt) return "off";
  const last = lastSignalAt(agent);
  if (last && now - new Date(last).getTime() < ACTIVE_WINDOW_MS)
    return "running";
  return "quiet";
}

/** Newest proof of life, whether or not it produced any work. */
export function lastSignalAt(agent: TRegisterAgent): string | null {
  const times = [agent.heartbeatAt, agent.lastPostedAt].filter(
    (t): t is string => Boolean(t),
  );
  if (times.length === 0) return null;
  return times.reduce((latest, t) => (t > latest ? t : latest));
}

/**
 * How recent an agent is, as a number to sort on. An agent holding a live lease
 * outranks every timestamp: it is working right now, which is more recent than
 * anything that already finished. Never-active agents fall to the bottom rather
 * than sorting as if they acted in 1970.
 */
export function activityRank(agent: TRegisterAgent, now = Date.now()): number {
  if (isWorking(agent, now)) return Number.MAX_SAFE_INTEGER;
  const last = lastSignalAt(agent);
  return last ? new Date(last).getTime() : 0;
}

/** Newest first. Equal recency falls back to the name, so the order is stable. */
export function sortByActivity<A extends TRegisterAgent>(
  agents: A[],
  now = Date.now(),
): A[] {
  return [...agents].sort((a, b) => {
    const diff = activityRank(b, now) - activityRank(a, now);
    if (diff !== 0) return diff;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * `on` and `off` follow the card's switch, not the clock: a quiet agent is
 * still switched on, and hiding it under "Active" would make the toggle lie.
 * `archived` is the only view that shows filed-away agents; every other view
 * hides them, which is the point of archiving one.
 */
export type TActiveFilter = "all" | "on" | "off" | "archived";

/** Board clusters, or one flat list ordered by recency. */
export type TAgentGrouping = "board" | "none";

type TAgentPreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Accessing the property itself can throw in sandboxed or hardened browsers. */
export function getAgentPreferenceStorage(source: {
  readonly localStorage: TAgentPreferenceStorage;
}): TAgentPreferenceStorage | null {
  try {
    return source.localStorage;
  } catch {
    return null;
  }
}

/** Account-scoped so two people sharing a browser never inherit each other's view. */
export function agentGroupingStorageKey(accountId: string | number): string {
  return `hypertask:agents:group:v1:${accountId}`;
}

export function readRememberedAgentGrouping(
  storage: Pick<TAgentPreferenceStorage, "getItem"> | null,
  accountId: string | number,
): TAgentGrouping | null {
  try {
    if (!storage) return null;
    const value = storage.getItem(agentGroupingStorageKey(accountId));
    return value === "board" || value === "none" ? value : null;
  } catch {
    // Private browsing and hardened browser policies can reject localStorage.
    return null;
  }
}

export function writeRememberedAgentGrouping(
  storage: Pick<TAgentPreferenceStorage, "setItem"> | null,
  accountId: string | number,
  grouping: TAgentGrouping,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(agentGroupingStorageKey(accountId), grouping);
    return true;
  } catch {
    return false;
  }
}

export type TAgentFilters = {
  teamId: string | null;
  boardId: number | null;
  active: TActiveFilter;
  group: TAgentGrouping;
};

export const defaultAgentFilters: TAgentFilters = {
  teamId: null,
  boardId: null,
  active: "all",
  group: "board",
};

/** Sorting changes order only; it must not make the result count read as filtered. */
export function hasAgentContentFilters(filters: TAgentFilters): boolean {
  return Boolean(
    filters.teamId || filters.boardId || filters.active !== "all",
  );
}

type TReadParam = { get(key: string): string | null };

/** Filters live in the URL so a filtered register stays bookmarkable. */
export function parseAgentFilters(params: TReadParam | null): TAgentFilters {
  if (!params) return defaultAgentFilters;
  const active = params.get("active");
  const boardId = Number(params.get("board"));
  return {
    teamId: params.get("team") || null,
    boardId: Number.isInteger(boardId) && boardId > 0 ? boardId : null,
    active:
      active === "on" || active === "off" || active === "archived"
        ? active
        : "all",
    group: params.get("group") === "none" ? "none" : "board",
  };
}

/**
 * A URL names the view for this visit and therefore wins over local state.
 * Without an explicit grouping, restore the last option chosen by this account.
 */
export function resolveAgentFilters(
  params: TReadParam | null,
  rememberedGrouping: TAgentGrouping | null,
): TAgentFilters {
  const filters = parseAgentFilters(params);
  const explicitGrouping = params?.get("group");
  if (explicitGrouping === "board" || explicitGrouping === "none") {
    return filters;
  }
  return {
    ...filters,
    group: rememberedGrouping ?? filters.group,
  };
}

/** The query string for a filter set, empty when nothing is filtered. */
export function agentFiltersToQuery(
  filters: TAgentFilters,
  options: { preserveDefaultGrouping?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (filters.teamId) params.set("team", filters.teamId);
  if (filters.boardId) params.set("board", String(filters.boardId));
  if (filters.active !== "all") params.set("active", filters.active);
  if (filters.group !== "board" || options.preserveDefaultGrouping) {
    params.set("group", filters.group);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export type TTeamOption = { id: string; name: string };

/**
 * Every team the caller can reach an agent through. Teams come from boards, so
 * an agent on no visible board contributes none — it shows under "All teams".
 */
export function listTeams(agents: TRegisterAgent[]): TTeamOption[] {
  const byId = new Map<string, string>();
  for (const agent of agents) {
    for (const board of agent.boards ?? []) {
      if (board.teamId && !byId.has(board.teamId)) {
        byId.set(board.teamId, board.teamName || "Untitled team");
      }
    }
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Boards the caller can pick, narrowed to the chosen team. */
export function listBoards(
  agents: TRegisterAgent[],
  teamId: string | null,
): { id: number; name: string }[] {
  const byId = new Map<number, string>();
  for (const agent of agents) {
    for (const board of agent.boards ?? []) {
      if (teamId && board.teamId !== teamId) continue;
      if (!byId.has(board.id)) byId.set(board.id, board.name);
    }
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterAgents<A extends TRegisterAgent>(
  agents: A[],
  filters: TAgentFilters,
): A[] {
  return agents.filter((agent) => {
    // Archived agents are out of every view but their own, including "All
    // agents" — an archive you still have to scroll past is not an archive.
    if (filters.active === "archived") {
      if (!agent.archivedAt) return false;
    } else if (agent.archivedAt) {
      return false;
    }
    if (filters.active === "on" && agent.revokedAt) return false;
    if (filters.active === "off" && !agent.revokedAt) return false;
    // One board has to satisfy both, not one each: a URL naming team A and a
    // board in team B otherwise keeps agents that clustering then finds no
    // board for, and they pile up under "No board" as if they had none.
    if (filters.teamId || filters.boardId) {
      return (agent.boards ?? []).some(
        (b) =>
          (!filters.teamId || b.teamId === filters.teamId) &&
          (!filters.boardId || b.id === filters.boardId),
      );
    }
    return true;
  });
}

export type TAgentCluster<A extends TRegisterAgent> = {
  /** null is the catch-all for agents on no board you can see. */
  board: { id: number; name: string } | null;
  agents: A[];
};

/**
 * One cluster per board, with an agent appearing under every board it works
 * on — that is what "cluster by board" means, and picking a primary board
 * would be inventing a relationship the data does not have.
 */
export function clusterByBoard<A extends TRegisterAgent>(
  agents: A[],
  filters: TAgentFilters = defaultAgentFilters,
  now = Date.now(),
): TAgentCluster<A>[] {
  const clusters = new Map<number, TAgentCluster<A>>();
  const boardless: A[] = [];

  for (const agent of agents) {
    const boards = (agent.boards ?? []).filter((board) => {
      if (filters.teamId && board.teamId !== filters.teamId) return false;
      if (filters.boardId && board.id !== filters.boardId) return false;
      return true;
    });
    if (boards.length === 0) {
      boardless.push(agent);
      continue;
    }
    for (const board of boards) {
      const existing = clusters.get(board.id);
      if (existing) existing.agents.push(agent);
      else {
        clusters.set(board.id, {
          board: { id: board.id, name: board.name },
          agents: [agent],
        });
      }
    }
  }

  // Recency, not the alphabet: the register answers "what is happening", so a
  // board whose agents worked in the last minute belongs above one that has
  // been idle for a month. A board is as recent as its most recent agent.
  const sorted = [...clusters.values()]
    .map((cluster) => ({
      ...cluster,
      agents: sortByActivity(cluster.agents, now),
    }))
    .sort((a, b) => {
      const diff =
        activityRank(b.agents[0], now) - activityRank(a.agents[0], now);
      if (diff !== 0) return diff;
      return (a.board?.name ?? "").localeCompare(b.board?.name ?? "");
    });
  // Board-less agents last: they are real agents, not an error state, and
  // dropping them is how they silently disappear from the register. They stay
  // pinned below the boards whatever their recency — the section is a
  // catch-all, not a board that happens to be busy.
  if (boardless.length > 0) {
    sorted.push({ board: null, agents: sortByActivity(boardless, now) });
  }
  return sorted;
}

/**
 * What the register renders: board clusters, or the same agents as one flat
 * recency-ordered list when the grouping is switched off.
 */
export function viewAgents<A extends TRegisterAgent>(
  agents: A[],
  filters: TAgentFilters = defaultAgentFilters,
  now = Date.now(),
): TAgentCluster<A>[] {
  const visible = filterAgents(agents, filters);
  if (filters.group === "none") {
    // One cluster with no board, which the register draws without a heading:
    // ungrouped means ungrouped, not everything filed under "No board".
    return visible.length > 0
      ? [{ board: null, agents: sortByActivity(visible, now) }]
      : [];
  }
  return clusterByBoard(visible, filters, now);
}
