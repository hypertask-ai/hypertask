import { Prisma, PrismaClient, Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getProjectViewInclude } from "@/utils/controllers/projects/getAll";
import type { TaskDetailSlug } from "./types";
import type { IComment } from "@/models/model";
import { CYCLE_WINDOW_SIZE } from "@/lib/cycles";
import {
  publicAgentSelect,
  sanitizeAgentCredentials,
} from "@/lib/agents/publicAgent";

type Db = Pick<PrismaClient, "$queryRaw">;

const slimUser = Prisma.sql`
  JSONB_BUILD_OBJECT(
    'id', u.id,
    'displayName', u."displayName",
    'photoURL', u."photoURL",
    'email', u.email
  )
`;

const publicCommentCreator = Prisma.sql`
  CASE WHEN creator.id IS NULL THEN 'null'::jsonb ELSE JSONB_BUILD_OBJECT(
    'id', creator.id,
    'displayName', creator."displayName",
    'photoURL', creator."photoURL",
    'email', creator.email
  ) END
`;

const publicCommentAgent = Prisma.sql`
  CASE WHEN agent.id IS NULL THEN 'null'::jsonb ELSE JSONB_BUILD_OBJECT(
    'id', agent.id,
    'userId', agent."userId",
    'displayName', agent."displayName",
    'photoURL', agent."photoURL",
    'createdAt', agent."createdAt",
    'revokedAt', agent."revokedAt",
    'runtimeType', agent."runtimeType",
    'heartbeatAt', agent."heartbeatAt",
    'permissions', agent.permissions
  ) END
`;

// Assignment activity stores a user snapshot for durable names, but older
// snapshots omitted photoURL. Resolve the current photo at read time so
// historical rows follow the same image-first avatar contract as new rows.
const assignmentActivityWithCurrentAvatars = Prisma.sql`
  CASE
    WHEN c.activity->>'type' = 'TaskAssigned' THEN
      jsonb_set(
        jsonb_set(
          c.activity,
          '{data,fromUser,user,photoURL}',
          COALESCE(to_jsonb(activity_from_user."photoURL"), 'null'::jsonb),
          true
        ),
        '{data,toUser,user,photoURL}',
        COALESCE(to_jsonb(activity_to_user."photoURL"), 'null'::jsonb),
        true
      )
    ELSE c.activity
  END
`;

const userSelect = {
  id: true,
  displayName: true,
  photoURL: true,
  email: true,
} satisfies Prisma.UserSelect;

export function parseProjectSlug(projectSlug: string): number {
  return parseInt(projectSlug.split("-")[1], 10);
}

/**
 * A detail URL always carries a ticket number. Without one (`/detail/project-15`)
 * `parseInt` yields NaN, and Prisma rejects NaN as a filter value rather than
 * matching nothing, so the page 500'd instead of showing anything (HTPR-4838).
 * Returns null when the slug cannot address a task.
 */
export function parseDetailSlug(
  slug: string[] | undefined
): { projectId: number; uniqueIndex: number } | null {
  const projectId = parseProjectSlug(slug?.[0] ?? "");
  const uniqueIndex = parseInt(slug?.[1] ?? "", 10);
  if (!Number.isInteger(projectId) || !Number.isInteger(uniqueIndex)) return null;
  return { projectId, uniqueIndex };
}

export function taskWhere(
  slug: TaskDetailSlug,
  userId: number
): Prisma.TaskWhereInput {
  return {
    uniqueIndex: slug.uniqueIndex,
    status: { not: Status.Deleted },
    project: {
      id: slug.projectId,
      status: { not: Status.Deleted },
      OR: [
        { members: { some: { userId } } },
        { ownerId: userId },
      ],
    },
  };
}

/** Task detail SSR — fields used by TaskDetailComp + hooks (see taskDetail benchmark parity). */
export function taskDetailInclude(userId: number): Prisma.TaskInclude {
  return {
    user: { select: userSelect },
    description_: {
      select: {
        id: true,
        content: true,
        taskId: true,
        flaggedIncomplete: true,
        attachments: {
          select: {
            id: true,
            fileName: true,
            fileType: true,
            fileSize: true,
            fileSource: true,
          },
        },
      },
    },
    priority: true,
    estimate: true,
    cycle: true,
    drafts: { where: { userId, saved: false } },
    notifications: {
      where: {
        status: Status.Normal,
        userId,
        task: {
          Reminders: { every: { status: { not: Status.Normal } } },
        },
      },
      take: 1,
      orderBy: { createdAt: "desc" },
    },
    _count: {
      select: {
        notifications: { where: { status: Status.Normal, userId } },
      },
    },
    assignees: {
      include: {
        user: { select: userSelect },
        agent: { select: { id: true, displayName: true, photoURL: true } },
      },
    },
    project: {
      select: {
        id: true,
        title: true,
        name: true,
        teamId: true,
        ownerId: true,
        timeTrackingEnabled: true,
        stalenessEnabled: true,
        staleWarnDays: true,
        staleHotDays: true,
        staleNudgeEnabled: true,
        autoArchiveAfterDays: true,
        cyclesEnabled: true,
        cycles: {
          where: { endDate: { gt: new Date() } },
          orderBy: { startDate: "asc" },
          take: CYCLE_WINDOW_SIZE,
        },
        // The detail page sets `currentProjectAtom` from this payload, and the
        // AI model picker derives the board's plan from it. Without the
        // subscription rows and BYOK flags a paid board reads as Free, so a
        // ticket opened from a board-agnostic view (All views, inbox, search)
        // locked every premium model and fell back to GPT-5.4 mini
        // (HTPR-5541). Same fields the board list already sends
        // (`teamBillingSnapshotSelect`).
        team: {
          include: {
            googleAccount: true,
            subscriptionPlan: {
              select: {
                priceId: true,
                subscriptionId: true,
                subscriptionStatus: true,
              },
              orderBy: { subscriptionStaretdAt: "desc" },
            },
            byokApiKeys: { select: { provider: true, enabled: true } },
          },
        },
        uniqueIdentifier: true,
        section: {
          where: { deleted: false },
          orderBy: { ranking: "asc" },
          select: {
            id: true,
            section_title: true,
            ranking: true,
            visibility: true,
            deleted: true,
          },
        },
        ai_custom_instructions: {
          select: {
            id: true,
            model_selected: true,
            source_selected: true,
            customInstruction: true,
          },
        },
        customFields: {
          orderBy: { ranking: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            options: true,
            ranking: true,
            showInRail: true,
          },
        },
      },
    },
    Task_Summary: { take: 1, orderBy: { createdAt: "desc" } },
    subTasks: {
      where: { status: { not: Status.Deleted } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        uniqueIndex: true,
        ticketNumber: true,
        title: true,
        status: true,
        projectId: true,
        sectionId: true,
        createdAt: true,
      },
    },
    parentTask: {
      select: {
        id: true,
        uniqueIndex: true,
        ticketNumber: true,
        title: true,
        projectId: true,
        subTasks: {
          where: { status: { not: Status.Deleted } },
          select: {
            id: true,
            uniqueIndex: true,
            ticketNumber: true,
            title: true,
          },
        },
      },
    },
    savedContent: {
      where: { commentId: null, userId },
      select: { id: true, type: true },
    },
    relatedToTasks: {
      include: {
        sourceTask: {
          select: {
            id: true,
            uniqueIndex: true,
            title: true,
            ticketNumber: true,
            projectId: true,
          },
        },
      },
    },
    relatedFromTasks: {
      include: {
        targetTask: {
          select: {
            id: true,
            uniqueIndex: true,
            title: true,
            ticketNumber: true,
            projectId: true,
          },
        },
      },
    },
    agent: { select: publicAgentSelect },
    pullRequests: {
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        repositoryOwner: true,
        repositoryName: true,
        number: true,
        url: true,
        title: true,
        lifecycle: true,
        checkState: true,
        headSha: true,
        updatedAt: true,
      },
    },
    customFieldValues: {
      select: { fieldId: true, value: true, numericValue: true },
    },
  };
}

/** Benchmark baseline — pre-optimization getTask.ts */
export function legacyTaskInclude(userId: number): Prisma.TaskInclude {
  return {
    project: {
      include: {
        section: { where: { deleted: false }, orderBy: { ranking: "asc" } },
        team: { include: { googleAccount: true } },
        ai_custom_instructions: true,
        project_view: getProjectViewInclude({ currentUserId: userId }),
      },
    },
    user: true,
    description_: { include: { attachments: true, reactions: true } },
    priority: true,
    estimate: true,
    drafts: { where: { userId, saved: false } },
    notifications: {
      where: {
        status: Status.Normal,
        userId,
        task: { Reminders: { every: { status: { not: Status.Normal } } } },
      },
      take: 1,
      orderBy: { createdAt: "desc" },
    },
    Task_Summary: { take: 1, orderBy: { createdAt: "desc" } },
    _count: {
      select: {
        notifications: { where: { status: Status.Normal, userId } },
      },
    },
    subTasks: {
      where: { status: { not: Status.Deleted } },
      orderBy: { createdAt: "asc" },
    },
    parentTask: {
      include: { subTasks: { where: { status: { not: Status.Deleted } } } },
    },
    savedContent: { where: { commentId: null, userId } },
    relatedToTasks: { include: { sourceTask: true } },
    relatedFromTasks: { include: { targetTask: true } },
    agent: { select: publicAgentSelect },
    assignees: {
      include: { user: true, agent: { select: publicAgentSelect } },
    },
  };
}

export async function fetchDescriptionReactions(descriptionId: string) {
  return fetchDescriptionReactionsWithDb(descriptionId);
}

export async function fetchTaskDetail(
  projectSlug: string,
  uniqueIndex: string | number,
  userId: number
) {
  // Guard here, not just at the page: getTask() takes `uniqueIndex: any` from
  // the API layer and would otherwise send NaN into Prisma too (HTPR-4838).
  const slug = parseDetailSlug([projectSlug, String(uniqueIndex)]);
  if (!slug) return null;

  const task = await prisma.task.findFirst({
    where: taskWhere(slug, userId),
    include: taskDetailInclude(userId),
  });

  if (!task) return null;

  const reactions = await fetchDescriptionReactions(task.description_?.id ?? "");
  return {
    ...task,
    description_: task.description_
      ? { ...task.description_, reactions }
      : task.description_,
  };
}

function commentsQuery(db: Db, taskId: number, userId: number) {
  return db.$queryRaw<IComment[]>`
    WITH base_comments AS (
      SELECT c.id, c.text, c.summary, c."taskId", c."creatorId", c."createdAt",
        ${assignmentActivityWithCurrentAvatars} AS activity,
        c."seen", c."agentId",
        ${publicCommentCreator} AS creator,
        ${publicCommentAgent} AS agent
      FROM "Comment" c
      LEFT JOIN "User" creator ON c."creatorId" = creator."id"
      LEFT JOIN "Agent" agent ON c."agentId" = agent."id"
      LEFT JOIN "User" activity_from_user ON activity_from_user.id =
        CASE WHEN c.activity->>'type' = 'TaskAssigned'
          THEN (c.activity #>> '{data,fromUser,userId}')::int END
      LEFT JOIN "User" activity_to_user ON activity_to_user.id =
        CASE WHEN c.activity->>'type' = 'TaskAssigned'
          THEN (c.activity #>> '{data,toUser,userId}')::int END
      WHERE c."taskId" = ${taskId}
    ),
    reaction_groups AS (
      SELECT r."commentId", r."emoji", r."unified",
        COUNT(r.id)::int AS "count", JSONB_AGG(${slimUser}) AS users
      FROM "Reaction" r
      JOIN "User" u ON r."userId" = u.id
      WHERE r."commentId" IN (SELECT id FROM base_comments) AND r."isDeleted" = false
      GROUP BY r."commentId", r."emoji", r."unified"
    ),
    reactions_by_comment AS (
      SELECT "commentId",
        JSONB_AGG(JSONB_BUILD_OBJECT(
          'emoji', "emoji", 'count', "count", 'unified', "unified", 'users', users
        )) AS reactions
      FROM reaction_groups GROUP BY "commentId"
    ),
    attachments_by_comment AS (
      SELECT a."commentId",
        JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', a.id, 'fileName', a."fileName", 'fileType', a."fileType",
          'fileSize', a."fileSize", 'fileSource', a."fileSource", 'commentId', a."commentId"
        )) AS attachments
      FROM "Attachment" a
      WHERE a."commentId" IN (SELECT id FROM base_comments)
      GROUP BY a."commentId"
    ),
    saved_by_comment AS (
      SELECT sc."commentId",
        JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', sc.id, 'type', sc."type", 'userId', sc."userId",
          'commentId', sc."commentId", 'taskId', sc."taskId"
        )) AS "savedContent"
      FROM "SavedContent" sc
      WHERE sc."commentId" IN (SELECT id FROM base_comments)
        AND sc."taskId" = ${taskId}
        AND ((sc."userId" = ${userId} AND sc."type" = 'Private') OR sc."type" = 'Public')
      GROUP BY sc."commentId"
    )
    SELECT bc.id, bc.text, bc.summary, bc."taskId", bc."creatorId", bc."createdAt",
      bc.activity, bc."seen", bc."agentId",
      COALESCE(rbc.reactions, '[]'::jsonb) AS reactions,
      COALESCE(abc.attachments, '[]'::jsonb) AS attachments,
      COALESCE(sbc."savedContent", '[]'::jsonb) AS "savedContent",
      bc.creator, bc.agent
    FROM base_comments bc
    LEFT JOIN reactions_by_comment rbc ON rbc."commentId" = bc.id
    LEFT JOIN attachments_by_comment abc ON abc."commentId" = bc.id
    LEFT JOIN saved_by_comment sbc ON sbc."commentId" = bc.id
    ORDER BY bc."createdAt" ASC
  `;
}

export async function fetchCommentsForTask(
  taskId: number,
  userId: number,
  db: Db = prisma
) {
  const comments = await commentsQuery(db, taskId, userId);
  return sanitizeAgentCredentials(comments) as IComment[];
}

export async function fetchDescriptionReactionsWithDb(
  descriptionId: string,
  db: Db = prisma
) {
  if (!descriptionId) return [];
  return db.$queryRaw`
    SELECT r."emoji", COUNT(r.id)::text AS "count", r."unified",
      JSONB_AGG(JSONB_BUILD_OBJECT(
        'id', u.id, 'displayName', u."displayName", 'photoURL', u."photoURL"
      )) AS "users"
    FROM "Reaction" r
    JOIN "User" u ON r."userId" = u.id
    WHERE r."descriptionId" = ${descriptionId} AND r."isDeleted" = false
    GROUP BY r."emoji", r."unified"
  `;
}

export async function fetchCommentsForSlug(slug: TaskDetailSlug, userId: number) {
  const { projectId, uniqueIndex } = slug;
  const comments = await prisma.$queryRaw<IComment[]>`
    WITH authorized_task AS (
      SELECT t.id FROM "Task" t
      INNER JOIN "Project" p ON t."projectId" = p.id
      WHERE t."uniqueIndex" = ${uniqueIndex} AND p.id = ${projectId}
        AND t.status <> 'Deleted'::"Status" AND p.status <> 'Deleted'::"Status"
        AND (p."ownerId" = ${userId} OR EXISTS (
          SELECT 1 FROM "Member" m WHERE m."projectId" = p.id AND m."userId" = ${userId}
        ))
      LIMIT 1
    ),
    task_row AS (SELECT id AS "taskId" FROM authorized_task),
    base_comments AS (
      SELECT c.id, c.text, c.summary, c."taskId", c."creatorId", c."createdAt",
        ${assignmentActivityWithCurrentAvatars} AS activity,
        c."seen", c."agentId",
        ${publicCommentCreator} AS creator,
        ${publicCommentAgent} AS agent
      FROM "Comment" c
      INNER JOIN task_row ti ON c."taskId" = ti."taskId"
      LEFT JOIN "User" creator ON c."creatorId" = creator."id"
      LEFT JOIN "Agent" agent ON c."agentId" = agent."id"
      LEFT JOIN "User" activity_from_user ON activity_from_user.id =
        CASE WHEN c.activity->>'type' = 'TaskAssigned'
          THEN (c.activity #>> '{data,fromUser,userId}')::int END
      LEFT JOIN "User" activity_to_user ON activity_to_user.id =
        CASE WHEN c.activity->>'type' = 'TaskAssigned'
          THEN (c.activity #>> '{data,toUser,userId}')::int END
    ),
    reaction_groups AS (
      SELECT r."commentId", r."emoji", r."unified",
        COUNT(r.id)::int AS "count", JSONB_AGG(${slimUser}) AS users
      FROM "Reaction" r
      JOIN "User" u ON r."userId" = u.id
      WHERE r."commentId" IN (SELECT id FROM base_comments) AND r."isDeleted" = false
      GROUP BY r."commentId", r."emoji", r."unified"
    ),
    reactions_by_comment AS (
      SELECT "commentId",
        JSONB_AGG(JSONB_BUILD_OBJECT(
          'emoji', "emoji", 'count', "count", 'unified', "unified", 'users', users
        )) AS reactions
      FROM reaction_groups GROUP BY "commentId"
    ),
    attachments_by_comment AS (
      SELECT a."commentId",
        JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', a.id, 'fileName', a."fileName", 'fileType', a."fileType",
          'fileSize', a."fileSize", 'fileSource', a."fileSource", 'commentId', a."commentId"
        )) AS attachments
      FROM "Attachment" a
      WHERE a."commentId" IN (SELECT id FROM base_comments)
      GROUP BY a."commentId"
    ),
    saved_by_comment AS (
      SELECT sc."commentId",
        JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', sc.id, 'type', sc."type", 'userId', sc."userId",
          'commentId', sc."commentId", 'taskId', sc."taskId"
        )) AS "savedContent"
      FROM "SavedContent" sc
      WHERE sc."commentId" IN (SELECT id FROM base_comments)
        AND sc."taskId" = (SELECT "taskId" FROM task_row)
        AND ((sc."userId" = ${userId} AND sc."type" = 'Private') OR sc."type" = 'Public')
      GROUP BY sc."commentId"
    )
    SELECT bc.id, bc.text, bc.summary, bc."taskId", bc."creatorId", bc."createdAt",
      bc.activity, bc."seen", bc."agentId",
      COALESCE(rbc.reactions, '[]'::jsonb) AS reactions,
      COALESCE(abc.attachments, '[]'::jsonb) AS attachments,
      COALESCE(sbc."savedContent", '[]'::jsonb) AS "savedContent",
      bc.creator, bc.agent
    FROM base_comments bc
    LEFT JOIN reactions_by_comment rbc ON rbc."commentId" = bc.id
    LEFT JOIN attachments_by_comment abc ON abc."commentId" = bc.id
    LEFT JOIN saved_by_comment sbc ON sbc."commentId" = bc.id
    ORDER BY bc."createdAt" ASC
  `;
  return sanitizeAgentCredentials(comments) as IComment[];
}

// ── Benchmark-only legacy queries ───────────────────────────────────────────

export function legacyCommentsQuery(db: Db, taskId: number, userId: number) {
  return db.$queryRaw`
    SELECT c.id, c.text, c.summary, c."taskId", c."creatorId", c."createdAt",
      c.activity, c."seen", c."agentId",
      (
        SELECT JSONB_AGG(reaction_data) FROM (
          SELECT JSONB_BUILD_OBJECT(
            'emoji', r."emoji", 'count', COUNT(r.id), 'unified', r."unified",
            'users', JSONB_AGG(u.*)
          ) AS reaction_data
          FROM "Reaction" r JOIN "User" u ON r."userId" = u.id
          WHERE r."commentId" = c.id AND r."isDeleted" = false
          GROUP BY r."emoji", r."unified"
        ) sq
      ) AS reactions,
      (SELECT JSONB_AGG(a.*) FROM "Attachment" a WHERE a."commentId" = c.id) AS attachments,
      COALESCE((
        SELECT JSONB_AGG(sc.*) FROM "SavedContent" sc
        WHERE sc."commentId" = c.id AND sc."taskId" = ${taskId}
          AND ((sc."userId" = ${userId} AND sc."type" = 'Private') OR sc."type" = 'Public')
      ), '[]'::jsonb) AS "savedContent",
      ${publicCommentCreator} AS creator,
      ${publicCommentAgent} AS agent
    FROM "Comment" c
    LEFT JOIN "User" creator ON c."creatorId" = creator."id"
    LEFT JOIN "Agent" agent ON c."agentId" = agent."id"
    WHERE c."taskId" = ${taskId}
    GROUP BY c.id, c.text, c.summary, c."taskId", c."creatorId", c."createdAt",
      c.seen, c.activity, c."agentId", creator."id", agent."id"
    ORDER BY c."createdAt" ASC
  `;
}

export function legacyDescriptionReactions(db: Db, descriptionId: string) {
  if (!descriptionId) return Promise.resolve([]);
  return db.$queryRaw`
    SELECT r."emoji", COUNT(r.id)::text AS "count", r."unified", JSONB_AGG(u.*) AS "users"
    FROM "Reaction" r JOIN "User" u ON r."userId" = u.id
    WHERE r."descriptionId" = ${descriptionId} AND r."isDeleted" = false
    GROUP BY r."emoji", r."unified"
  `;
}
