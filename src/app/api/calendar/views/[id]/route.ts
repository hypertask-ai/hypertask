import { logger as htLogger } from "#logger";
import { getAuthSession, withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isCalendarViewPatchInput } from "@/models/Calendar/model";
import {
  calendarViewSelect,
  canAccessEveryCalendarProject,
  getAccessibleCalendarProjectIds,
  serializeCalendarView,
} from "@/utils/controllers/views";

export const runtime = "nodejs";

async function PATCHHandler(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getAuthSession(request.headers);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { id } = await props.params;
    const existing = await prisma.calendar_View.findUnique({
      where: { id },
      select: calendarViewSelect,
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Calendar view not found" },
        { status: 404 },
      );
    }
    if (existing.userId !== session.userId) {
      return NextResponse.json(
        { success: false, error: "Only the owner can modify this view" },
        { status: 403 },
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
    if (!isCalendarViewPatchInput(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid calendar view update" },
        { status: 400 },
      );
    }

    const nextVisibility = body.visibility ?? existing.visibility;
    const nextProjectIds = body.projectIds ?? existing.projectIds;
    if (nextVisibility === "Public") {
      if (nextProjectIds.length === 0) {
        return NextResponse.json(
          { success: false, error: "A shared view must include a board" },
          { status: 400 },
        );
      }
      const accessibleProjectIds = new Set(
        await getAccessibleCalendarProjectIds(session.userId),
      );
      if (
        !canAccessEveryCalendarProject(nextProjectIds, accessibleProjectIds)
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

    const data: Prisma.Calendar_ViewUncheckedUpdateInput = {};
    if (body.title !== undefined) data.title = body.title.trim();
    if (body.visibility !== undefined) data.visibility = body.visibility;
    if (body.projectIds !== undefined) data.projectIds = body.projectIds;
    if (body.taskFilters !== undefined) {
      data.taskFilters = body.taskFilters as Prisma.InputJsonValue;
    }
    if (body.settings !== undefined) {
      data.settings = body.settings as Prisma.InputJsonValue;
    }
    if (body.sort !== undefined) {
      data.sort =
        body.sort === null
          ? Prisma.DbNull
          : (body.sort as Prisma.InputJsonValue);
    }

    const view = await prisma.calendar_View.update({
      where: { id },
      data,
      select: calendarViewSelect,
    });
    return NextResponse.json({
      success: true,
      view: serializeCalendarView(view),
    });
  } catch (error) {
    htLogger.error("Error updating calendar view:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

async function DELETEHandler(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getAuthSession(request.headers);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { id } = await props.params;
    const existing = await prisma.calendar_View.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Calendar view not found" },
        { status: 404 },
      );
    }
    if (existing.userId !== session.userId) {
      return NextResponse.json(
        { success: false, error: "Only the owner can delete this view" },
        { status: 403 },
      );
    }

    await prisma.calendar_View.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    htLogger.error("Error deleting calendar view:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

export const PATCH = withAuth(PATCHHandler);
export const DELETE = withAuth(DELETEHandler);
