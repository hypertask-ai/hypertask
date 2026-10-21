
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
  outOfTokens?: boolean | null;
};

export function isWorking(agent: TRegisterAgent, now = Date.now()): boolean {
  if (!agent.working) return false;
  return new Date(agent.working.expiresAt).getTime() > now;
}

export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type TAgentStatus = "running" | "quiet" | "off";

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

export function lastSignalAt(agent: TRegisterAgent): string | null {
  const times = [agent.heartbeatAt, agent.lastPostedAt].filter(
    (t): t is string => Boolean(t),
  );
  if (times.length === 0) return null;
  return times.reduce((latest, t) => (t > latest ? t : latest));
}

export type TChatRosterStatus =
  | { kind: "active" }
  | { kind: "out-of-tokens" }
  | { kind: "idle"; since: string }
  | { kind: "inactive" };

export function chatRosterStatus(
  agent: TRegisterAgent,
  now = Date.now(),
): TChatRosterStatus {
  if (agent.revokedAt) return { kind: "inactive" };
  if (agent.outOfTokens) return { kind: "out-of-tokens" };
  if (isWorking(agent, now)) return { kind: "active" };
  const last = lastSignalAt(agent);
  if (last && now - new Date(last).getTime() < ACTIVE_WINDOW_MS) {
    return { kind: "idle", since: last };
  }
  return { kind: "inactive" };
}

export function activityRank(agent: TRegisterAgent, now = Date.now()): number {
  if (isWorking(agent, now)) return Number.MAX_SAFE_INTEGER;
  const last = lastSignalAt(agent);
  return last ? new Date(last).getTime() : 0;
}

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

export type TActiveFilter = "all" | "on" | "off" | "archived";

export type TAgentGrouping = "board" | "none";

type TAgentPreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function getAgentPreferenceStorage(source: {
  readonly localStorage: TAgentPreferenceStorage;
}): TAgentPreferenceStorage | null {
  try {
    return source.localStorage;
  } catch {
    return null;
  }
}

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

export function hasAgentContentFilters(filters: TAgentFilters): boolean {
  return Boolean(
    filters.teamId || filters.boardId || filters.active !== "all",
  );
}

type TReadParam = { get(key: string): string | null };

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
    if (filters.active === "archived") {
      if (!agent.archivedAt) return false;
    } else if (agent.archivedAt) {
      return false;
    }
    if (filters.active === "on" && agent.revokedAt) return false;
    if (filters.active === "off" && !agent.revokedAt) return false;
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
  board: { id: number; name: string } | null;
  agents: A[];
};

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
  if (boardless.length > 0) {
    sorted.push({ board: null, agents: sortByActivity(boardless, now) });
  }
  return sorted;
}

export function viewAgents<A extends TRegisterAgent>(
  agents: A[],
  filters: TAgentFilters = defaultAgentFilters,
  now = Date.now(),
): TAgentCluster<A>[] {
  const visible = filterAgents(agents, filters);
  if (filters.group === "none") {
    return visible.length > 0
      ? [{ board: null, agents: sortByActivity(visible, now) }]
      : [];
  }
  return clusterByBoard(visible, filters, now);
}
