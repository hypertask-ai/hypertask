import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6585_BOARD_REPORTS_FLAG } from "@/lib/flags/keys";
import {
  buildVelocityReport,
  resolveVelocityRange,
  type VelocityTaskRow,
  velocityWindow,
} from "@/lib/velocity";
import { doneColumnTitles, isDoneByName } from "@/lib/doneColumns";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextRequest, NextResponse } from "next/server";

const WORKED_ON_TASK_LIMIT = 100;
const MERGED_PULL_REQUEST_LIMIT = 5;

export async function GET(request: NextRequest) {
  const userId = (await getSessionUser(request.headers))?.userId;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isFeatureEnabled(HTPR_6585_BOARD_REPORTS_FLAG, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
      { status: 400 }
    );
  }
  const now = new Date();
  const range = resolveVelocityRange(
    request.nextUrl.searchParams.get("range"),
    request.nextUrl.searchParams.get("from"),
    request.nextUrl.searchParams.get("to"),
    now
  );

  try {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...getProjectWhere(userId),
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

    if (!project) {
      return NextResponse.json(
        { error: "Board not found" },
        { status: 404 }
      );
    }

    const { priorStart, windowStart, windowEnd } = velocityWindow(now, range);
    const selectedWindow = { gte: windowStart, lte: windowEnd };

    // Scans every non-deleted open board task; fine on demand, but use groupBy on a hot path.
    const [
      tasks,
      comments,
      updatedTaskActivity,
      commentActivity,
      moveActivity,
      mergedPullRequestActivity,
    ] = await Promise.all([
      prisma.task.findMany({
        where: {
          projectId,
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
          createdAt: selectedWindow,
          task: { projectId },
        },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.task.findMany({
        where: {
          projectId,
          deletedAt: null,
          status: { not: "Deleted" },
          updatedAt: selectedWindow,
        },
        orderBy: { updatedAt: "desc" },
        take: WORKED_ON_TASK_LIMIT,
        select: { id: true, createdAt: true, updatedAt: true },
      }),
      prisma.comment.groupBy({
        by: ["taskId"],
        where: {
          createdAt: selectedWindow,
          OR: [{ creatorId: { not: null } }, { agentId: { not: null } }],
          task: {
            projectId,
            deletedAt: null,
            status: { not: "Deleted" },
          },
        },
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: "desc" } },
        take: WORKED_ON_TASK_LIMIT,
      }),
      prisma.taskSectionEvent.groupBy({
        by: ["taskId"],
        where: {
          timestamp: selectedWindow,
          task: {
            projectId,
            deletedAt: null,
            status: { not: "Deleted" },
          },
        },
        _max: { timestamp: true },
        orderBy: { _max: { timestamp: "desc" } },
        take: WORKED_ON_TASK_LIMIT,
      }),
      prisma.taskPullRequest.groupBy({
        by: ["taskId"],
        where: {
          lifecycle: "merged",
          sourceUpdatedAt: selectedWindow,
          task: {
            projectId,
            deletedAt: null,
            status: { not: "Deleted" },
          },
        },
        _max: { sourceUpdatedAt: true },
        orderBy: { _max: { sourceUpdatedAt: "desc" } },
        take: WORKED_ON_TASK_LIMIT,
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
      [project.owner, ...project.members.map(({ user }) => user)].map(
        (member) => [
          member.id,
          {
            userId: member.id,
            displayName: member.displayName ?? member.email,
            email: member.email,
          },
        ]
      )
    );
    const activityByTask = new Map<
      number,
      { activities: Set<string>; lastActivityAt: Date }
    >();
    const recordActivity = (taskId: number, activity: string, at: Date | null) => {
      if (!at) return;
      const existing = activityByTask.get(taskId);
      if (existing) {
        existing.activities.add(activity);
        if (at > existing.lastActivityAt) existing.lastActivityAt = at;
        return;
      }
      activityByTask.set(taskId, {
        activities: new Set([activity]),
        lastActivityAt: at,
      });
    };
    updatedTaskActivity.forEach((task) => {
      if (task.updatedAt && task.updatedAt > task.createdAt) {
        recordActivity(task.id, "Updated", task.updatedAt);
      }
    });
    commentActivity.forEach((activity) =>
      recordActivity(activity.taskId, "Commented", activity._max.createdAt)
    );
    moveActivity.forEach((activity) =>
      recordActivity(activity.taskId, "Moved", activity._max.timestamp)
    );
    mergedPullRequestActivity.forEach((activity) =>
      recordActivity(
        activity.taskId,
        "Merged PR",
        activity._max.sourceUpdatedAt
      )
    );

    const workedOnTaskIds = Array.from(activityByTask.entries())
      .sort((left, right) =>
        right[1].lastActivityAt.getTime() - left[1].lastActivityAt.getTime()
      )
      .slice(0, WORKED_ON_TASK_LIMIT)
      .map(([taskId]) => taskId);
    const workedOnTasks = workedOnTaskIds.length === 0
      ? []
      : await prisma.task.findMany({
          where: {
            id: { in: workedOnTaskIds },
            projectId,
            deletedAt: null,
            status: { not: "Deleted" },
          },
          select: {
            id: true,
            projectId: true,
            uniqueIndex: true,
            ticketNumber: true,
            title: true,
            pullRequests: {
              where: {
                lifecycle: "merged",
                sourceUpdatedAt: selectedWindow,
              },
              orderBy: { sourceUpdatedAt: "desc" },
              take: MERGED_PULL_REQUEST_LIMIT,
              select: { title: true, url: true },
            },
          },
        });
    const workedOn = workedOnTasks
      .map((task) => {
        const activity = activityByTask.get(task.id)!;
        return {
          id: task.id,
          ticketNumber: task.ticketNumber ?? String(task.uniqueIndex),
          title: task.title,
          href: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
          activities: Array.from(activity.activities),
          lastActivityAt: activity.lastActivityAt.toISOString(),
          mergedPullRequests: task.pullRequests,
        };
      })
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

    return NextResponse.json(
      buildVelocityReport(
        taskRows,
        comments.flatMap((comment) =>
          comment.creatorId === null || comment._max.createdAt === null
            ? []
            : [{
                userId: comment.creatorId,
                comments: comment._count._all,
                lastCommentAt: comment._max.createdAt,
              }]
        ),
        Array.from(memberMap.values()),
        now,
        range,
        {
          warnDays: project.staleWarnDays,
          hotDays: project.staleHotDays,
        },
        doneColumnTitles(project.section, isDoneByName),
        workedOn
      )
    );
  } catch (error) {
    console.error("[reports/velocity] Unable to build report:", error);
    return NextResponse.json(
      { error: "Unable to load velocity report" },
      { status: 500 }
    );
  }
}
