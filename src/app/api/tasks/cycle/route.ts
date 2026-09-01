import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getProjectCycleOverview } from "@/lib/cycleService";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import type { IUser } from "@/models/model";

const MAX_DATABASE_ID = 2_147_483_647;

const validDatabaseId = (value: number): number | null =>
  Number.isSafeInteger(value) && value > 0 && value <= MAX_DATABASE_ID ? value : null;

const queryId = (value: string | null): number | null =>
  value && /^\d+$/.test(value) ? validDatabaseId(Number(value)) : null;

const jsonId = (value: unknown): number | null =>
  typeof value === "number" ? validDatabaseId(value) : null;

const accessibleTask = (taskId: number, userId: number) =>
  prisma.task.findFirst({
    where: {
      id: taskId,
      status: "Normal",
      project: {
        status: "Normal",
        ...taskWriteAccessWhere(userId),
      },
    },
    select: {
      id: true,
      cycleId: true,
      projectId: true,
      project: { select: { cyclesEnabled: true } },
      cycle: true,
    },
  });

const serverError = (operation: "load" | "update", error: unknown) => {
  console.error(`[task-cycle] ${operation} failed`, error);
  return NextResponse.json(
    { error: operation === "load" ? "Unable to load cycles" : "Unable to update cycle" },
    { status: 500 },
  );
};

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request.headers);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const taskId = queryId(request.nextUrl.searchParams.get("taskId"));
    if (!taskId) {
      return NextResponse.json({ error: "A valid taskId is required" }, { status: 400 });
    }

    const task = await accessibleTask(taskId, session.userId);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const cursor = queryId(request.nextUrl.searchParams.get("cursor"));
    const query = request.nextUrl.searchParams.get("query")?.trim().slice(0, 40) ?? "";
    const numberMatch = query.match(/\d+/)?.[0];
    const cycleNumber = numberMatch ? queryId(numberMatch) : null;
    const [cycles, overview] = await Promise.all([
      prisma.cycle.findMany({
        where: {
          projectId: task.projectId,
          ...(numberMatch ? { number: cycleNumber ?? -1 } : {}),
        },
        orderBy: [{ startDate: "desc" }, { id: "desc" }],
        take: 21,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      getProjectCycleOverview(task.projectId),
    ]);
    const page = cycles.slice(0, 20);
    const assignableIds = new Set(
      [overview?.current?.id, overview?.next?.id].filter(
        (id): id is number => typeof id === "number",
      ),
    );

    return NextResponse.json({
      enabled: task.project.cyclesEnabled,
      assignedCycle: task.cycle,
      cycles: page.map((cycle) => ({
        ...cycle,
        assignable: task.project.cyclesEnabled && assignableIds.has(cycle.id),
      })),
      nextCursor: cycles.length > 20 ? page.at(-1)?.id ?? null : null,
    });
  } catch (error) {
    return serverError("load", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request.headers);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const taskId = jsonId(body?.taskId);
    const cycleId = body?.cycleId === null ? null : jsonId(body?.cycleId);
    if (!taskId || (body?.cycleId !== null && !cycleId)) {
      return NextResponse.json(
        { error: "taskId and a valid cycleId or null are required" },
        { status: 400 },
      );
    }

    const task = await accessibleTask(taskId, session.userId);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    let cycle = null;
    if (cycleId !== null) {
      if (!task.project.cyclesEnabled) {
        return NextResponse.json(
          { error: "Cycles are disabled for this board" },
          { status: 409 },
        );
      }
      const overview = await getProjectCycleOverview(task.projectId);
      if (cycleId !== overview?.current?.id && cycleId !== overview?.next?.id) {
        return NextResponse.json(
          { error: "Only the current or next cycle can be assigned" },
          { status: 400 },
        );
      }
      cycle = cycleId === overview.current?.id ? overview.current : overview.next;
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await updateTaskSingle(
      { id: task.id, cycleId },
      user as unknown as IUser,
    );
    if (result.status !== 200) {
      return NextResponse.json(
        { error: result.json?.message ?? "Unable to update cycle" },
        { status: result.status },
      );
    }

    const broadcasts = await Promise.allSettled([
      broadcastBoardChange(task.projectId, { originUserId: session.userId }),
      broadcastTaskChange(task.id, { originUserId: session.userId }),
    ]);
    for (const broadcast of broadcasts) {
      if (broadcast.status === "rejected") {
        console.error("[task-cycle] realtime broadcast failed", broadcast.reason);
      }
    }
    return NextResponse.json({ cycle, cycleId });
  } catch (error) {
    return serverError("update", error);
  }
}
