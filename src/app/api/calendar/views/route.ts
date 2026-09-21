import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  isCalendarViewCreateInput,
  isCalendarViewsPreference,
} from "@/models/Calendar/model";
import { isCalendarViewVisibleToViewer } from "@/models/Calendar/visibility";
import {
  calendarViewSelect,
  canAccessEveryCalendarProject,
  getAccessibleCalendarProjectIds,
  serializeCalendarView,
} from "./_lib";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request.headers);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    await prisma.$transaction(async (tx) => {
      const settings = await tx.userSetting.findUnique({
        where: { userId: session.userId },
        select: { calendarViews: true },
      });
      if (
        !isCalendarViewsPreference(settings?.calendarViews) ||
        settings.calendarViews.views.length === 0
      ) {
        return;
      }

      const legacyPreference = settings.calendarViews;
      await tx.calendar_View.createMany({
        data: legacyPreference.views.map((view) => ({
          id: view.id,
          userId: session.userId,
          title: view.title,
          visibility: "Private",
          projectIds: view.checkedProjects,
          taskFilters: view.taskFilters as Prisma.InputJsonValue,
          settings: view.settings as Prisma.InputJsonValue,
          sort:
            view.sort === null
              ? Prisma.DbNull
              : (view.sort as Prisma.InputJsonValue),
        })),
        skipDuplicates: true,
      });
      // Clear only the exact snapshot we migrated. A concurrent preference
      // write wins, and a later GET safely retries the idempotent createMany.
      await tx.userSetting.updateMany({
        where: {
          userId: session.userId,
          calendarViews: {
            equals: legacyPreference as Prisma.InputJsonValue,
          },
        },
        data: {
          calendarViews: {
            ...legacyPreference,
            views: [],
          } as Prisma.InputJsonValue,
        },
      });
    });

    const accessibleProjectIds = await getAccessibleCalendarProjectIds(
      session.userId,
    );
    const accessibleProjectIdSet = new Set(accessibleProjectIds);
    const candidates = await prisma.calendar_View.findMany({
      where: {
        OR: [
          { userId: session.userId },
          ...(accessibleProjectIds.length > 0
            ? [
                {
                  visibility: "Public" as const,
                  projectIds: { hasSome: accessibleProjectIds },
                },
              ]
            : []),
        ],
      },
      select: calendarViewSelect,
      orderBy: { createdAt: "asc" },
    });
    const views = candidates
      .filter((view) =>
        isCalendarViewVisibleToViewer(
          view,
          session.userId,
          accessibleProjectIdSet,
        ),
      )
      .map(serializeCalendarView);

    return NextResponse.json({ success: true, views });
  } catch (error) {
    console.error("Error listing calendar views:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request.headers);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON" },
        { status: 400 },
      );
    }
    if (!isCalendarViewCreateInput(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid calendar view" },
        { status: 400 },
      );
    }

    if (body.visibility === "Public") {
      if (body.projectIds.length === 0) {
        return NextResponse.json(
          { success: false, error: "A shared view must include a board" },
          { status: 400 },
        );
      }
      const accessibleProjectIds = new Set(
        await getAccessibleCalendarProjectIds(session.userId),
      );
      if (
        !canAccessEveryCalendarProject(body.projectIds, accessibleProjectIds)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "You cannot share a view containing inaccessible boards",
          },
          { status: 403 },
        );
      }
    }

    const view = await prisma.calendar_View.create({
      data: {
        userId: session.userId,
        title: body.title.trim(),
        visibility: body.visibility,
        projectIds: body.projectIds,
        taskFilters: body.taskFilters as Prisma.InputJsonValue,
        settings: body.settings as Prisma.InputJsonValue,
        sort:
          body.sort === null
            ? Prisma.DbNull
            : (body.sort as Prisma.InputJsonValue),
      },
      select: calendarViewSelect,
    });

    return NextResponse.json(
      { success: true, view: serializeCalendarView(view) },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating calendar view:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
