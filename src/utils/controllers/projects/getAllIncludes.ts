import { Prisma, Status, ViewVisibility } from "@prisma/client";
import { publicAgentSelect } from "@/lib/agents/publicAgent";
import { utcDate } from "@/lib/cycles";

export type GetAllIncludesOptions = {
  userId: number;
  userDbId: number;
  currentUserId?: number;
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

// Authorization for reading task content from a specific board. Unlike
// getProjectWhere this intentionally permits legacy teamless boards. A
// delegate keeps its connecting human's owner/member scope and may additionally
// access boards where that owned, active agent is a member.
export const projectContentAccessWhere = (
  userId: number,
  agentId?: string | null
): Prisma.ProjectWhereInput => ({
  OR: [
    ...humanProjectAccessBranches(userId, agentId),
    ...(agentId
      ? [
          {
            members: {
              some: { agentId, agent: { userId, revokedAt: null } },
            },
          },
        ]
      : []),
  ],
});

// HTPR-4982: who may write to a board. Deliberately not getProjectWhere: this
// is authorization, not listing, so it does not care about team scoping (an
// old teamless board still belongs to its owner). An agent counts only when
// the caller owns it and it has not been revoked.
export const taskWriteAccessWhere = (
  userId: number,
  agentId?: string | null
): Prisma.ProjectWhereInput => ({
  OR: [
    ...humanProjectAccessBranches(userId, agentId),
    ...(agentId
      ? [
          {
            members: {
              some: { agentId, agent: { userId, revokedAt: null } },
            },
          },
        ]
      : []),
  ],
});

export const getProjectWhere = (
  userId: number,
  agentId?: string | null
): Prisma.ProjectWhereInput => ({
  teamId: { not: null },
  OR: [
    ...humanProjectAccessBranches(userId, agentId),
    ...(agentId
      ? [
          {
            // HTPR-4982: the agent must also belong to the caller. Matching on
            // the agent id alone lets anyone who knows it borrow board access.
            members: {
              some: { agentId, agent: { userId, revokedAt: null } },
            },
          },
        ]
      : []),
  ],
});

// Board discovery is deliberately narrower than delegate authorization. An
// agent may act as its connecting human on routes that target a known board,
// but board pickers and bootstrap payloads must expose only boards where that
// agent was explicitly added. Otherwise a single-board token enumerates every
// board its owner can access (HTPR-5208).
export const getProjectListingWhere = (
  userId: number,
  agentId?: string | null
): Prisma.ProjectWhereInput =>
  agentId
    ? {
        teamId: { not: null },
        members: {
          some: { agentId, agent: { userId, revokedAt: null } },
        },
      }
    : getProjectWhere(userId);

export const getTaskWhere = (): Prisma.TaskWhereInput => ({
  status: "Normal",
});

// Only notification count remains — comment count is read from Task.totalComments (scalar column).
export const getTaskCountSelect = (userId: number) => ({
  select: {
    notifications: {
      where: {
        agentId: null,
        status: Status.Normal,
        userId,
      },
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
  where: {
    status: Status.Normal,
    userId,
    agentId: null,
    task: {
      Reminders: {
        every: {
          status: { not: Status.Normal },
        },
      },
    },
  },
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

/** Kanban comment badge uses Task.totalComments; _count is notification-only. */
export const getTaskIncludeLayers = ({
  userId,
  userDbId,
}: GetAllIncludesOptions): Record<string, Prisma.TaskInclude> => {
  const count = { _count: getTaskCountSelect(userId) };
  const assignees = {
    assignees: {
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
  // Kanban-only fields — see CardSubTasks, task playlist, Homepage.updateParentTask
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
  // Pointer for archive/delete flows — no nested parent.subTasks (Neon was loading them twice)
  const parentTask = {
    parentTask: {
      select: {
        id: true,
        sectionId: true,
        ticketNumber: true,
        title: true,
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

// Board/Table only reads assignment identity, label identity, and the latest
// inbox marker. Richer relation rows still load on task-detail surfaces.
export const getBoardTaskInclude = (
  options: GetAllIncludesOptions
): Prisma.TaskInclude => {
  const layers = getTaskIncludeLayers(options);
  return mergeTaskIncludes(
    layers.count,
    {
      assignees: {
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
            // Hypertask labels have no per-label color column. Board/Table
            // render the shared label theme from value and filter by id; the
            // prompt, timestamps, project relation, and reverse task relation
            // are not part of the authenticated board rendering contract.
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
    layers.priorityEstimate,
    layers.subTasks,
    layers.parentTask,
    layers.savedContent
  );
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
        appliedView: true,
        unsavedView: true,
        userId: true,
        appliedViewId: true,
        unsavedViewId: true,
        project_view_id: true,
        view_order: true,
      },
    },
    default_view: true,
  },
});

export const getProjectAllViewsInclude = ({
  currentUserId,
}: {
  currentUserId: number | undefined;
}) => ({
  where: {
    OR: [
      { visibility: ViewVisibility.Public },
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
      },
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

// Inactive boards only need enough data to remain addressable in the shared
// cache and to expose their columns to cross-board task actions. Feature-heavy
// metadata is fetched with the board payload when that board becomes active.
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
    take: 2,
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
  // Attachments load when the custom-instruction modal opens (not needed for board paint)
  ai_custom_instructions: {
    select: {
      id: true,
      model_selected: true,
      source_selected: true,
      customInstruction: true,
    },
  },
});

/**
 * Long-form task content and server-maintained delivery/deletion bookkeeping
 * are fetched on demand or used only by background jobs. Board/Table does not
 * read them, and every nullable key otherwise repeats once per task.
 */
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
