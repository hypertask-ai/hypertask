import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { agentScopeEnforced } from "@/lib/auth/agentScope";
import { Prisma, Status, ViewVisibility } from "@prisma/client";
import { publicAgentSelect } from "@/lib/agents/publicAgent";
import { CYCLE_WINDOW_SIZE, utcDate } from "@/lib/cycles";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";
import { visibleUserInboxWhere } from "@/utils/controllers/notifications/visibleInboxScope";

export type GetAllIncludesOptions = {
  userId: number;
  userDbId: number;
  currentUserId?: number;
  includeCachedDescription?: boolean;
};

const humanProjectAccessBranches = (
  userId: number,
  agentId?: string | null,
): Prisma.ProjectWhereInput[] => {
  if (!agentId) {
    return [
      { ownerId: userId },
      { members: { some: { userId, agentId: null } } },
    ];
  }

  if (agentScopeEnforced()) {
    return [{ members: { some: { agentId, status: "Accepted", agent: { userId, revokedAt: null } } } }];
  }
  const activeAgent = { id: agentId, userId, revokedAt: null };
  return [
    {
      owner: {
        id: userId,
        agents: { some: activeAgent },
      },
    },
    {
      members: {
        some: {
          userId,
          agentId: null,
          user: { agents: { some: activeAgent } },
        },
      },
    },
  ];
};

export const intersectProjectTeamScope = (
  existing: Prisma.ProjectWhereInput,
  teamScope?: AgentTokenTeamScope | null,
): Prisma.ProjectWhereInput => {
  if (teamScope == null) return existing;
  if (typeof teamScope.teamId !== "string" || !teamScope.teamId.trim() ||
      typeof teamScope.accessBinding !== "string" || !teamScope.accessBinding.trim()) return { id: { in: [] } };
  return { AND: [existing, { teamId: teamScope.teamId }] };
};

export const projectContentAccessWhere = (
  userId: number,
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
): Prisma.ProjectWhereInput => intersectProjectTeamScope({
  OR: [
    ...humanProjectAccessBranches(userId, agentId),
    ...(agentId && !agentScopeEnforced()
      ? [
          {
            members: {
              some: { agentId, agent: { userId, revokedAt: null } },
            },
          },
        ]
      : []),
  ],
}, teamScope);

export const taskWriteAccessWhere = (
  userId: number,
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
): Prisma.ProjectWhereInput => intersectProjectTeamScope({
  OR: [
    ...humanProjectAccessBranches(userId, agentId),
    ...(agentId && !agentScopeEnforced()
      ? [
          {
            members: {
              some: { agentId, agent: { userId, revokedAt: null } },
            },
          },
        ]
      : []),
  ],
}, teamScope);

export const getProjectWhere = (
  userId: number,
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
): Prisma.ProjectWhereInput => intersectProjectTeamScope({
  teamId: { not: null },
  OR: [
    ...humanProjectAccessBranches(userId, agentId),
    ...(agentId && !agentScopeEnforced()
      ? [
          {
            members: {
              some: { agentId, agent: { userId, revokedAt: null } },
            },
          },
        ]
      : []),
  ],
}, teamScope);

export const getProjectListingWhere = (
  userId: number,
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
): Prisma.ProjectWhereInput => intersectProjectTeamScope(
  agentId
    ? agentScopeEnforced() ? getProjectWhere(userId, agentId) : {
        teamId: { not: null },
        members: {
          some: { agentId, agent: { userId, revokedAt: null } },
        },
      }
    : getProjectWhere(userId),
  teamScope,
);

export const getTaskWhere = (): Prisma.TaskWhereInput => ({
  status: "Normal",
});

export const getTaskCountSelect = (userId: number) => ({
  select: {
    notifications: {
      where: visibleUserInboxWhere(userId),
    },
    relatedFromTasks: {
      where: {
        relationType: "BlockedBy" as const,
      },
    },
    relatedToTasks: {
      where: {
        relationType: "BlockedTo" as const,
      },
    },
  },
});

const getTaskNotificationsArgs = (userId: number) => ({
  where: visibleUserInboxWhere(userId),
  take: 1,
  orderBy: {
    createdAt: "desc" as const,
  },
});

export const getTaskNotificationsInclude = (
  userId: number
): Prisma.TaskInclude => ({
  notifications: getTaskNotificationsArgs(userId),
});

export const getTaskIncludeLayers = ({
  userId,
  userDbId,
}: GetAllIncludesOptions): Record<string, Prisma.TaskInclude> => {
  const count = { _count: getTaskCountSelect(userId) };
  const assignees = {
    assignees: {
      where: {
        OR: [
          { agentId: null },
          { agent: boardAgentVisibilityWhere(userId) },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            photoURL: true,
          },
        },
        agent: {
          select: {
            id: true,
            displayName: true,
            photoURL: true,
          },
        },
      },
    },
  };
  const taskLabels = {
    taskLabels: { include: { label: true } },
  };
  const notifications = getTaskNotificationsInclude(userId);
  const priorityEstimate = {
    priority: {
      select: {
        id: true,
        priority_index: true,
        Priority_Value: true,
      },
    },
    estimate: {
      select: {
        id: true,
        estimate_index: true,
        estimate_value: true,
      },
    },
  };
  const boardSubTaskSelect = {
    id: true,
    uniqueIndex: true,
    ticketNumber: true,
    title: true,
    status: true,
    projectId: true,
    sectionId: true,
  } satisfies Prisma.TaskSelect;

  const subTasks = {
    subTasks: {
      where: { status: { not: Status.Deleted } },
      orderBy: { createdAt: "asc" as const },
      select: boardSubTaskSelect,
    },
  };
  const parentTask = {
    parentTask: {
      select: {
        id: true,
        sectionId: true,
        ticketNumber: true,
        title: true,
        projectId: true,
      },
    },
  };
  const savedContent = {
    savedContent: {
      where: {
        commentId: null,
        userId: userDbId,
      },
    },
  };

  return {
    count,
    assignees,
    taskLabels,
    notifications,
    priorityEstimate,
    subTasks,
    parentTask,
    savedContent,
  };
};

export const mergeTaskIncludes = (
  ...parts: Prisma.TaskInclude[]
): Prisma.TaskInclude => Object.assign({}, ...parts);

export const getFullTaskInclude = (
  options: GetAllIncludesOptions
): Prisma.TaskInclude => {
  const layers = getTaskIncludeLayers(options);
  return mergeTaskIncludes(
    layers.count,
    layers.assignees,
    layers.taskLabels,
    layers.notifications,
    layers.priorityEstimate,
    layers.subTasks,
    layers.parentTask,
    layers.savedContent
  );
};

export const getBoardTaskInclude = (
  options: GetAllIncludesOptions
): Prisma.TaskInclude => {
  const layers = getTaskIncludeLayers(options);
  return mergeTaskIncludes(
    layers.count,
    {
      assignees: {
        where: {
          OR: [
            { agentId: null },
            { agent: boardAgentVisibilityWhere(options.userId) },
          ],
        },
        select: {
          id: true,
          userId: true,
          agentId: true,
          user: {
            select: {
              id: true,
              displayName: true,
              photoURL: true,
            },
          },
          agent: {
            select: {
              id: true,
              displayName: true,
              photoURL: true,
            },
          },
        },
      },
    },
    {
      taskLabels: {
        select: {
          id: true,
          label: {
            select: {
              id: true,
              value: true,
            },
          },
        },
      },
    },
    {
      notifications: {
        ...getTaskNotificationsArgs(options.userId),
        select: {
          id: true,
          taskId: true,
          type: true,
          seen: true,
        },
      },
    },
    {
      relatedFromTasks: {
        where: {
          relationType: "BlockedBy",
          targetTask: {
            project: { is: getProjectWhere(options.userId) },
          },
        },
        select: {
          targetTask: {
            select: {
              id: true,
              projectId: true,
              uniqueIndex: true,
              ticketNumber: true,
              title: true,
              status: true,
              section: true,
            },
          },
        },
      },
    },
    layers.priorityEstimate,
    layers.subTasks,
    layers.parentTask,
    layers.savedContent,
    options.includeCachedDescription ? { description_: { select: { content: true } } } : {}
  );
};

export const savedViewBoardAccessWhere = (
  userId: number,
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
): Prisma.ProjectWhereInput => {
  if (agentId && agentScopeEnforced()) return intersectProjectTeamScope({ OR: [{ members: { some: { agentId, status: "Accepted", agent: { userId, revokedAt: null } } } }] }, teamScope);
  const activeAgent = { id: agentId!, userId, revokedAt: null };
  return intersectProjectTeamScope({
    OR: [
      agentId
        ? { owner: { id: userId, agents: { some: activeAgent } } }
        : { ownerId: userId },
      { members: { some: {
        userId, agentId: null, status: "Accepted",
        ...(agentId ? { user: { agents: { some: activeAgent } } } : {}),
      } } },
      ...(agentId ? [{ members: { some: {
        agentId, status: "Accepted" as const,
        agent: { userId, revokedAt: null },
      } } }] : []),
    ],
  }, teamScope);
};

export const getProjectViewBaseInclude = ({
  currentUserId,
}: {
  currentUserId: number | undefined;
}) => ({
  include: {
    user_project_views: {
      where: {
        userId: currentUserId,
      },
      select: {
        appliedView: {
          include: {
            ViewLastUsed: {
              where: { userId: currentUserId },
              select: { board_empty_sections: true },
              take: 1,
            },
          },
        },
        unsavedView: true,
        userId: true,
        appliedViewId: true,
        unsavedViewId: true,
        project_view_id: true,
        view_order: true,
      },
    },
    default_view: {
      include: {
        ViewLastUsed: {
          where: { userId: currentUserId },
          select: { board_empty_sections: true },
          take: 1,
        },
      },
    },
  },
});

export const getProjectAllViewsInclude = ({
  currentUserId,
}: {
  currentUserId: number | undefined;
}) => ({
  where: {
    OR: [
      ...(currentUserId !== undefined
        ? [{ visibility: ViewVisibility.Public, project_view: { project: savedViewBoardAccessWhere(currentUserId) } }]
        : []),
      { userId: currentUserId, visibility: ViewVisibility.Private },
    ],
    title: { not: { equals: "" } },
  },
  include: {
    owner: {
      select: {
        photoURL: true,
      },
    },
    ViewLastUsed: {
      where: {
        userId: currentUserId,
      },
      select: {
        lastUsedAt: true,
        board_empty_sections: true,
      },
      take: 1,
    },
  },
  orderBy: {
    lastUsedAt: "desc" as const,
  },
});

export const getProjectViewInclude = ({
  currentUserId,
}: {
  currentUserId: number | undefined;
}) => ({
  include: {
    ...getProjectViewBaseInclude({ currentUserId }).include,
    allViews: getProjectAllViewsInclude({ currentUserId }),
  },
});

const boardUserSelect = {
  id: true,
  displayName: true,
  photoURL: true,
  email: true,
} satisfies Prisma.UserSelect;

export const projectBootstrapSelect = {
  id: true,
  name: true,
  title: true,
  ownerId: true,
  createdAt: true,
  status: true,
  googleAccountId: true,
  teamId: true,
  sorting_mode: true,
  uniqueIdentifier: true,
  timeTrackingEnabled: true,
  showTimeTotals: true,
  stalenessEnabled: true,
  staleWarnDays: true,
  staleHotDays: true,
  staleNudgeEnabled: true,
  autoArchiveAfterDays: true,
  cyclesEnabled: true,
  _count: {
    select: {
      section: {
        where: {
          deleted: false,
          visibility: false,
        },
      },
    },
  },
  section: {
    where: {
      deleted: false,
    },
    orderBy: {
      ranking: "asc" as const,
    },
  },
} satisfies Prisma.ProjectSelect;

export const getProjectIncludeWithoutTasks = (
  options: GetAllIncludesOptions
): Prisma.ProjectInclude => ({
  members: {
    where: {
      OR: [
        { agentId: null },
        { agent: boardAgentVisibilityWhere(options.userId) },
      ],
    },
    include: {
      user: { select: boardUserSelect },
      agent: { select: publicAgentSelect },
    },
  },
  owner: { select: boardUserSelect },
  _count: {
    select: {
      section: {
        where: {
          deleted: false,
          visibility: false,
        },
      },
    },
  },
  section: {
    where: {
      deleted: false,
    },
    orderBy: {
      ranking: "asc",
    },
  },
  cycles: {
    where: { endDate: { gt: utcDate() } },
    orderBy: { startDate: "asc" },
    take: CYCLE_WINDOW_SIZE,
  },
  team: {
    include: {
      googleAccount: true,
      team_activity: true,
      subscriptionPlan: {
        select: {
          id: true,
          priceId: true,
          subscriptionId: true,
          subscriptionStatus: true,
          subscriptionStaretdAt: true,
        },
        orderBy: {
          subscriptionStaretdAt: "desc",
        },
      },
      byokApiKeys: {
        select: {
          provider: true,
          enabled: true,
        },
      },
    },
  },
  project_view: getProjectViewBaseInclude({
    currentUserId: options.currentUserId,
  }) as Prisma.ProjectInclude["project_view"],
  ai_custom_instructions: {
    select: {
      id: true,
      model_selected: true,
      source_selected: true,
      customInstruction: true,
    },
  },
});

export const taskBoardOmit = {
  description: true,
  descriptionJson: true,
  staleNudgedAt: true,
  dueDateNotifiedAt: true,
  permanentlyDeleteAt: true,
  hardDeleteProcessingAt: true,
  deletedAt: true,
  archivedAt: true,
} satisfies Prisma.TaskOmit;

export const getFullProjectInclude = (
  options: GetAllIncludesOptions
): Prisma.ProjectInclude => ({
  ...getProjectIncludeWithoutTasks(options),
  tasks: {
    omit: taskBoardOmit,
    include: getFullTaskInclude(options),
    where: getTaskWhere(),
  },
});
