import { currentProjectAtom, currentUserAtom } from "@/store";
import type { IAgent } from "@/models/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRecoilValue } from "@/lib/state";

export const agentsQueryKey = (userId: number, teamId: string) =>
  ["agents", userId, teamId] as const;

export const boardAgentsQueryKey = (projectId: number) =>
  ["boardAgents", projectId] as const;

async function fetchAgents(teamId: string): Promise<IAgent[]> {
  const params = new URLSearchParams({ teamId });
  const res = await fetch(`/api/agents?${params.toString()}`);
  const data = (await res.json()) as {
    success?: boolean;
    agents?: IAgent[];
    error?: string;
  };
  if (!res.ok || !data.success || !Array.isArray(data.agents)) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Failed to load agents",
    );
  }
  return data.agents;
}

/** Agents explicitly added to the current board via Member.agentId */
async function fetchBoardAgents(projectId: number): Promise<IAgent[]> {
  const res = await fetch("/api/agents/all?projectId=" + projectId);
  const data = (await res.json()) as {
    success?: boolean;
    agents?: IAgent[];
    error?: string;
  };
  if (!res.ok || !data.success || !Array.isArray(data.agents)) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "Failed to load board agents",
    );
  }
  return data.agents;
}

export type CreateAgentVariables = {
  displayName: string;
  photoURL?: string;
  runtimeType?: "EXTERNAL" | "NATIVE";
  prompt?: string;
};

export type UpdateAgentVariables = {
  id: string;
  displayName?: string;
  photoURL?: string | null;
  postsToImportant?: boolean;
  prompt?: string | null;
};

export type AddAgentToBoardVariables = {
  projectId: number;
  agentId: string;
};

type AgentRevocationResult = Pick<IAgent, "id" | "revokedAt"> & {
  token?: string | null;
};

function mergeAgentRevocation(
  agents: IAgent[] | undefined,
  updatedAgent: AgentRevocationResult,
): IAgent[] | undefined {
  return agents?.map((agent) =>
    agent.id === updatedAgent.id
      ? { ...agent, revokedAt: updatedAgent.revokedAt }
      : agent,
  );
}

/**
 * Shared TanStack cache for `/api/agents` plus mutations (create, update, revoke).
 * `allAgents` = agents on the current board (board-scoped).
 */
export function useAgents(
  options: {
    projectId?: number | null;
    teamId?: string | null;
  } = {},
) {
  const currentUser = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const userId = currentUser?.id;
  const projectId =
    options.projectId === undefined ? currentProject?.id : options.projectId;
  const teamId =
    options.teamId === undefined ? currentProject?.teamId : options.teamId;
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey:
      typeof userId === "number" && teamId
        ? agentsQueryKey(userId, teamId)
        : ["agents", "none"],
    queryFn: () => fetchAgents(teamId!),
    enabled: typeof userId === "number" && Boolean(teamId),
    refetchOnWindowFocus: false,
  });

  const boardQuery = useQuery({
    queryKey:
      typeof projectId === "number"
        ? boardAgentsQueryKey(projectId)
        : ["boardAgents", "none"],
    queryFn: () => fetchBoardAgents(projectId!),
    enabled: typeof projectId === "number" && projectId > 0,
    refetchOnWindowFocus: false,
  });

  const invalidate = () => {
    if (typeof userId === "number" && teamId) {
      void queryClient.invalidateQueries({
        queryKey: agentsQueryKey(userId, teamId),
      });
    }
    if (typeof projectId === "number") {
      void queryClient.invalidateQueries({
        queryKey: boardAgentsQueryKey(projectId),
      });
    }
  };

  const createAgent = useMutation({
    mutationFn: async (vars: CreateAgentVariables) => {
      if (typeof projectId !== "number") {
        throw new Error("Open a team board before creating an agent");
      }
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...vars, projectId }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        agent?: IAgent;
        error?: string;
      };
      if (!res.ok || !data.success || !data.agent) {
        throw new Error(data.error ?? "Failed to create agent");
      }
      return data.agent;
    },
    onSuccess: invalidate,
  });

  const updateAgent = useMutation({
    mutationFn: async (vars: UpdateAgentVariables) => {
      const { id, ...body } = vars;
      const res = await fetch(`/api/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        success?: boolean;
        agent?: IAgent;
        error?: string;
      };
      if (!res.ok || !data.success || !data.agent) {
        throw new Error(data.error ?? "Failed to update agent");
      }
      return data.agent;
    },
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const revokeAgent = useMutation({
    mutationFn: async ({
      agentId,
      revoked,
    }: {
      agentId: string;
      revoked: boolean;
    }) => {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoked }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        agent?: AgentRevocationResult;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.success || !data.agent) {
        throw new Error(data.error ?? "Could not revoke");
      }
      return { ...data.agent, token: data.token ?? null };
    },
    onSuccess: (updatedAgent) => {
      // Reflect the server result before the confirmation closes. Waiting for
      // invalidation left disabled agents visible long enough to look unchanged.
      if (typeof userId === "number" && teamId) {
        queryClient.setQueryData<IAgent[]>(
          agentsQueryKey(userId, teamId),
          (agents) => mergeAgentRevocation(agents, updatedAgent),
        );
      }
      if (typeof projectId === "number") {
        queryClient.setQueryData<IAgent[]>(
          boardAgentsQueryKey(projectId),
          (agents) => mergeAgentRevocation(agents, updatedAgent),
        );
      }
      invalidate();
    },
  });

  const addAgentToBoard = useMutation({
    mutationFn: async ({ projectId, agentId }: AddAgentToBoardVariables) => {
      const res = await fetch("/api/members/addAgent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, agentId }),
      });
      const data = (await res.json()) as {
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          data.message ?? data.error ?? "Could not add agent to board",
        );
      }
      return data;
    },
    onSuccess: invalidate,
  });

  return {
    userId,
    agents: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    error: listQuery.error,
    refetch: listQuery.refetch,
    createAgent,
    updateAgent,
    revokeAgent,
    addAgentToBoard,
    allAgents: boardQuery.data ?? [],
    isBoardAgentsLoading: boardQuery.isLoading,
  };
}
