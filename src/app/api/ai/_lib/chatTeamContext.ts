import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { withAgentScopeRequest, prepareAgentScope } from "@/lib/auth/agentScope";
import prisma from "@/lib/prisma";
import {
  storePlanIdForTeam,
  type TeamPlanSource,
} from "@/app/api/ai/_lib/planGate";
import { STORE_PLAN_RANK } from "@/lib/planFromStripePriceId";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export type ChatTeamContext = {
  teamId: string;
  projectId: number | null;
  aiProviderSettings: unknown;
};

export type ChatProviderContext = {
  planGateProjectId: number | null;
  keyLookupContext: {
    trustedTeamId?: string;
    userId: number;
    agentId?: string | null;
  };
};

export function buildChatProviderContext(
  userId: number,
  context: ChatTeamContext | null,
  requestedProjectId?: number,
  requestedTeamId?: string,
): ChatProviderContext | null {
  if (!context) {
    if (
      requestedProjectId != null ||
      Boolean(requestedTeamId?.trim())
    ) {
      return null;
    }
    return {
      planGateProjectId: null,
      keyLookupContext: { userId },
    };
  }

  return {
    planGateProjectId: context.projectId,
    keyLookupContext: { trustedTeamId: context.teamId, userId },
  };
}

type ResolveChatTeamContextInput = {
  teamScope?: AgentTokenTeamScope | null;
  userId: number;
  requestedProjectId?: number;
  requestedTeamId?: string;
  sessionId?: string;
};

const teamSelect = {
  id: true,
  aiProviderSettings: true,
} as const;

const projectSelect = {
  id: true,
  teamId: true,
  team: { select: { aiProviderSettings: true } },
} as const;

const accountTeamSelect = {
  id: true,
  aiProviderSettings: true,
  activeSubscriptionPlanId: true,
  compedUntil: true,
  compedPlan: true,
  subscriptionPlan: {
    select: {
      subscriptionId: true,
      subscriptionStatus: true,
      priceId: true,
    },
  },
} as const;

type AccountTeam = TeamPlanSource & {
  id: string;
  aiProviderSettings: unknown;
};

function teamContext(
  team: { id: string; aiProviderSettings: unknown },
): ChatTeamContext {
  return { teamId: team.id, projectId: null, aiProviderSettings: team.aiProviderSettings };
}

function projectContext(project: {
  id: number;
  teamId: string | null;
  team?: { aiProviderSettings: unknown } | null;
}): ChatTeamContext | null {
  if (!project.teamId) return null;
  return {
    teamId: project.teamId,
    projectId: project.id,
    aiProviderSettings: project.team?.aiProviderSettings,
  };
}

function selectAccountTeam(teams: readonly AccountTeam[]) {
  return teams.reduce<AccountTeam | null>((best, team) => {
    if (!best) return team;
    const teamRank = STORE_PLAN_RANK[storePlanIdForTeam(team)];
    const bestRank = STORE_PLAN_RANK[storePlanIdForTeam(best)];
    return teamRank > bestRank ? team : best;
  }, null);
}

export function resolveChatTeamContext(input: ResolveChatTeamContextInput): Promise<ChatTeamContext | null> {
  return withAgentScopeRequest({ url: "/api/ai/chat/stream", method: "POST" }, () => readChatTeamContext(input));
}

async function readChatTeamContext({
  userId,
  requestedProjectId,
  requestedTeamId,
  sessionId,
  teamScope,
}: ResolveChatTeamContextInput): Promise<ChatTeamContext | null> {
  const findProject = (projectId: number, agentId?: string | null) =>
    prisma.project.findFirst({
      where: {
        id: projectId,
        status: "Normal",
        ...getProjectWhere(userId, agentId, teamScope),
      },
      select: projectSelect,
    });

  const findTeam = (teamId: string) =>
    prisma.team.findFirst({
      where: {
        id: teamId,
        OR: [
          { googleAccount: { userId } },
          { members: { some: { userId, status: "Accepted" } } },
        ],
      },
      select: teamSelect,
    });

  const teamId = requestedTeamId?.trim();
  if (requestedProjectId != null && teamId) {
    const [project, team] = await Promise.all([
      findProject(requestedProjectId),
      findTeam(teamId),
    ]);
    if (!project || !team) return null;
    return projectContext(project) ?? {
      ...teamContext(team),
      projectId: project.id,
    };
  }

  let projectId: number | null = null;
  if (requestedProjectId != null) {
    const project = await findProject(requestedProjectId);
    const context = project ? projectContext(project) : null;
    if (context) return context;
    projectId = project?.id ?? null;
  }

  if (teamId) {
    const team = await findTeam(teamId);
    if (team) return teamContext(team);
  }

  const session = sessionId
    ? await prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
        select: { projectId: true, agentId: true },
      })
    : null;

  if (session?.agentId) {
    await prepareAgentScope(userId, session.agentId);
    const project = await prisma.project.findFirst({
      where: {
        status: "Normal",
        members: {
          some: { agentId: session.agentId, status: "Accepted" },
        },
        ...getProjectWhere(userId, session.agentId, teamScope),
      },
      orderBy: { id: "asc" },
      select: {
        teamId: true,
        team: { select: { aiProviderSettings: true } },
      },
    });
    if (project?.teamId) {
      return teamContext({
        id: project.teamId,
        aiProviderSettings: project.team?.aiProviderSettings,
      });
    }
  }

  if ((requestedProjectId != null && projectId == null) || teamId) return null;

  if (projectId == null && session?.projectId != null) {
    const project = await findProject(session.projectId);
    const context = project ? projectContext(project) : null;
    if (context) return context;
  }

  const accountTeams = await prisma.team.findMany({
    where: {
      OR: [
        { googleAccount: { userId } },
        { members: { some: { userId, status: "Accepted" } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: accountTeamSelect,
  });
  const accountTeam = selectAccountTeam(accountTeams);
  return accountTeam ? { ...teamContext(accountTeam), projectId } : null;
}
