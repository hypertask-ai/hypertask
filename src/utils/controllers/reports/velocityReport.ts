import prisma from "@/lib/prisma";
import {
  buildVelocityReport,
  resolveVelocityRange,
  type VelocityReport,
  type VelocityTaskRow,
  velocityWindow,
} from "@/lib/velocity";
import { doneColumnTitles, isDoneByName } from "@/lib/doneColumns";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";

type LoadVelocityReportArgs = {
  projectId: number;
  userId: number;
  actingUserId: number;
  actingAgentId: string | null;
  teamScope: AgentTokenTeamScope | null;
  rangeKey: string | null;
  now?: Date;
};

export async function loadVelocityReport({
  projectId,
  userId,
  actingUserId,
  actingAgentId,
  teamScope,
  rangeKey,
  now = new Date(),
}: LoadVelocityReportArgs): Promise<VelocityReport | null> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...getProjectWhere(userId, null, teamScope),
      AND: [getProjectWhere(actingUserId, actingAgentId, teamScope)],
    },
    select: {
      staleWarnDays: true,
      staleHotDays: true,
      section: {
        where: { deleted: false },
        select: { section_title: true, isDone: true },
      },
      owner: {
        select: { id: true, displayName: true, email: true },
      },
      members: {
        where: { agentId: null },
        select: {
          user: {
            select: { id: true, displayName: true, email: true },
          },
        },
      },
    },
  });

  if (!project) return null;

  const range = resolveVelocityRange(rangeKey);
  const { priorStart, windowStart } = velocityWindow(now, range);

  const [tasks, comments] = await Promise.all([
    prisma.task.findMany({
      where: {
        projectId,
        project: getProjectWhere(actingUserId, actingAgentId, teamScope),
        deletedAt: null,
        status: { not: "Deleted" },
        OR: [
          { status: "Normal" },
          { updatedAt: { gte: priorStart } },
          { sectionChangedAt: { gte: priorStart } },
        ],
      },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        sectionChangedAt: true,
        lastCommentAt: true,
        section: true,
        status: true,
        assignees: {
          select: { userId: true },
        },
      },
    }),
    prisma.comment.groupBy({
      by: ["creatorId"],
      where: {
        createdAt: { gte: windowStart, lte: now },
        task: { projectId },
      },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);

  const taskRows: VelocityTaskRow[] = tasks.map((task) => ({
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    sectionChangedAt: task.sectionChangedAt,
    lastCommentAt: task.lastCommentAt,
    section: task.section,
    status: task.status,
    assigneeUserIds: task.assignees.map((assignee) => assignee.userId),
  }));
  const memberMap = new Map(
    [project.owner, ...project.members.map(({ user }) => user)].map((member) => [
      member.id,
      {
        userId: member.id,
        displayName: member.displayName ?? member.email,
        email: member.email,
      },
    ])
  );

  return buildVelocityReport(
    taskRows,
    comments.flatMap((comment) =>
      comment.creatorId === null || comment._max.createdAt === null
        ? []
        : [
            {
              userId: comment.creatorId,
              comments: comment._count._all,
              lastCommentAt: comment._max.createdAt,
            },
          ]
    ),
    Array.from(memberMap.values()),
    now,
    range,
    {
      warnDays: project.staleWarnDays,
      hotDays: project.staleHotDays,
    },
    doneColumnTitles(project.section, isDoneByName)
  );
}
