// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { notificationInboxInclude } from "@/utils/controllers/notifications/getAll";
import type { ArchiveBoardScope } from "@/store";

const ARCHIVED_INBOX_PAGE_SIZE = 50;

const archivedInboxOrderBy: Prisma.NotificationOrderByWithRelationInput[] = [
  { archivedAt: { sort: "desc", nulls: "last" } },
  { id: "desc" },
];

const parseOptionalInt = (value: string | string[] | undefined) => {
  const parsed = parseInt(Array.isArray(value) ? value[0] : value ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseOptionalQuery = (value: string | string[] | undefined) => {
  const query = (Array.isArray(value) ? value[0] : value)?.trim();
  return query || undefined;
};

const parseBoardScope = (value: string | string[] | undefined): ArchiveBoardScope => {
  const scope = Array.isArray(value) ? value[0] : value;
  return scope === "active" || scope === "archived" || scope === "all"
    ? scope
    : "active";
};

const getArchivedInboxWhere = (
  userId: number,
  projectId?: number | null,
  boardScope: ArchiveBoardScope = "active",
  q?: string
): Prisma.NotificationWhereInput => ({
  userId,
  status: "Archive",
  agentId: null,
  task: {
    project: {
      ...(boardScope === "all"
        ? {}
        : { status: boardScope === "active" ? "Normal" : "Archive" }),
      OR: [
        { ownerId: userId },
        {
          members: {
            some: {
              userId,
              agentId: null,
            },
          },
        },
      ],
    },
    ...(projectId ? { projectId } : {}),
    ...(q?.trim()
      ? {
          title: {
            contains: q.trim().toLowerCase(),
            mode: "insensitive",
          },
        }
      : {}),
    Reminders: {
      every: {
        status: { not: "Normal" },
      },
    },
  },
});

const getArchivedInboxMeta = async (
  userId: number,
  projectId?: number | null,
  boardScope: ArchiveBoardScope = "active"
) => {
  // One row per (type, taskId) so counts match the list's distinct de-dup.
  // ponytail: scans projectId-only rows for this user's archived notifications;
  // fine at personal-archive scale, swap to a raw GROUP BY if it ever grows huge.
  const rows = await prisma.notification.findMany({
    where: getArchivedInboxWhere(userId, projectId, boardScope),
    distinct: ["type", "taskId"],
    select: {
      projectId: true,
      task: {
        select: {
          projectId: true,
          project: { select: { id: true, name: true, title: true } },
        },
      },
    },
  });

  const byProject = new Map<
    number,
    { projectId: number; name: string; count: number }
  >();
  for (const row of rows) {
    const pid = row.task?.projectId ?? row.projectId;
    if (pid == null) continue;
    const existing = byProject.get(pid);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const project = row.task?.project;
    byProject.set(pid, {
      projectId: pid,
      name: project?.title ?? project?.name ?? `Project ${pid}`,
      count: 1,
    });
  }

  return {
    total: rows.length,
    byProject: Array.from(byProject.values()).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    ),
  };
};

export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    const user = JSON.parse(req.cookies.nookies_user!)
    const {cursor, mode, projectId, boardScope: rawBoardScope, q} = req.query
    const parsedCursor = parseOptionalInt(cursor);
    const parsedProjectId = parseOptionalInt(projectId);
    const boardScope = parseBoardScope(rawBoardScope);
    const parsedQuery = parseOptionalQuery(q);

    if (mode === "meta") {
      const meta = await getArchivedInboxMeta(
        user.id,
        parsedProjectId,
        boardScope
      );
      return res.status(200).json(meta);
    }

    const notificationsToReturn = await prisma.notification.findMany({
      take: ARCHIVED_INBOX_PAGE_SIZE,
      ...(parsedCursor ? { cursor: { id: parsedCursor }, skip: 1 } : {}),
      distinct: ["type", "taskId"],
      orderBy: archivedInboxOrderBy,
      include: notificationInboxInclude(user.id),
      where: getArchivedInboxWhere(
        user.id,
        parsedProjectId,
        boardScope,
        parsedQuery
      ),
    });

    return res.status(200).json(notificationsToReturn)
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
