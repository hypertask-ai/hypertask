import prisma from "@/lib/prisma";
import {
  buildVelocityReport,
  resolveVelocityRange,
  type VelocityTaskRow,
  velocityWindow,
} from "@/lib/velocity";
import { doneColumnTitles, isDoneByName } from "@/lib/doneColumns";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

type CookieUser = { id?: number };

async function getCurrentUserFromCookies(): Promise<CookieUser | null> {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    if (!userCookie?.value) return null;
    return JSON.parse(userCookie.value) as CookieUser;
  } catch (error) {
    console.log("🚀 ~ getCurrentUserFromCookies ~ error:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const cookieUser = await getCurrentUserFromCookies();
  const userId = Number(cookieUser?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
      { status: 400 }
    );
  }
  const range = resolveVelocityRange(
    request.nextUrl.searchParams.get("range")
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

    const now = new Date();
    const { priorStart, windowStart } = velocityWindow(now, range);

    // Scans every non-deleted open board task; fine on demand, but use groupBy on a hot path.
    const [tasks, comments] = await Promise.all([
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
          // Bounded at both ends: a comment written between capturing `now` and
          // this query would push _max past `now` and void the whole group.
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
        doneColumnTitles(project.section, isDoneByName)
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
