import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { buildCalendar, IcsTask } from "@/lib/calendar/ics";

export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_ISSUER = process.env.JWT_ISSUER || "hypertask";
const CALENDAR_AUDIENCE = "calendar-feed";

const PAST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const FUTURE_WINDOW_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * GET /api/calendar/feed?token=...
 * Read-only iCalendar feed of the user's tasks that have a due date.
 * Auth is the signed `token` query param (audience calendar-feed) so calendar
 * apps that can't send headers (Google Calendar "From URL") can subscribe.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return new NextResponse("Missing token", { status: 401 });
  }

  let userId: number;
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: CALENDAR_AUDIENCE,
    }) as jwt.JwtPayload;
    userId = Number(payload.userId);
    if (!Number.isFinite(userId)) {
      return new NextResponse("Invalid token", { status: 401 });
    }
  } catch {
    return new NextResponse("Invalid token", { status: 401 });
  }

  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: {
      status: "Normal",
      dueDate: {
        gte: new Date(now.getTime() - PAST_WINDOW_MS),
        lte: new Date(now.getTime() + FUTURE_WINDOW_MS),
      },
      project: { is: getProjectWhere(userId) },
    },
    select: {
      id: true,
      uniqueIndex: true,
      ticketNumber: true,
      title: true,
      section: true,
      projectId: true,
      dueDate: true,
    },
    orderBy: { dueDate: "asc" },
    take: 1000,
  });

  const events: IcsTask[] = tasks
    .filter((t): t is typeof t & { dueDate: Date } => t.dueDate !== null)
    .map((t) => ({
      id: t.id,
      uniqueIndex: t.uniqueIndex,
      ticketNumber: t.ticketNumber,
      title: t.title,
      section: t.section,
      projectId: t.projectId,
      dueDate: t.dueDate,
    }));

  const ics = buildCalendar(events, now);

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=hypertask.ics",
      "Cache-Control": "private, max-age=300",
    },
  });
}
