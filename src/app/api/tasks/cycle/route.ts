import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { jsonError, unauthorized } from "@/lib/api/response";
import { readJsonBody } from "@/lib/mcp/readJsonBody";
import { parsePositiveInt } from "@/lib/parsePositiveInt";
import { getProjectCycleOverview } from "@/lib/cycleService";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { taskAccessWhere } from "@/utils/controllers/tasks/assertTaskAccess";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import type { IUser } from "@/models/model";

const MAX_DATABASE_ID = 2_147_483_647;

const queryId = (value: string | null): number | null =>
  parsePositiveInt(value, { max: MAX_DATABASE_ID });

const jsonId = (value: unknown): number | null =>
  typeof value === "number" ? parsePositiveInt(value, { max: MAX_DATABASE_ID }) : null;

const accessibleTask = (taskId: number, userId: number) =>
  prisma.task.findFirst({
    where: taskAccessWhere(userId, taskId, {
      taskStatus: "Normal",
      projectStatus: "Normal",
      scope: "content",
    }),
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
  return jsonError(operation === "load" ? "Unable to load cycles" : "Unable to update cycle", 500);
};

export async function GET(request: NextRequest) {
  try {
    const session = await loadCurrentUser(request.headers);
    if (!session) return unauthorized();

    const taskId = queryId(request.nextUrl.searchParams.get("taskId"));
    if (!taskId) {
      return jsonError("A valid taskId is required", 400);
    }

    const task = await accessibleTask(taskId, session.userId);
    if (!task) return jsonError("Task not found", 404);

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
    const session = await loadCurrentUser(request.headers);
    if (!session) return unauthorized();

    const parsed = await readJsonBody<{ taskId?: unknown; cycleId?: unknown }>(request, {
      invalidJson: () => jsonError("taskId and a valid cycleId or null are required"),
      invalidObject: () => jsonError("taskId and a valid cycleId or null are required"),
    });
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const taskId = jsonId(body?.taskId);
    const cycleId = body?.cycleId === null ? null : jsonId(body?.cycleId);
    if (!taskId || (body?.cycleId !== null && !cycleId)) {
      return jsonError("taskId and a valid cycleId or null are required", 400);
    }

    const task = await accessibleTask(taskId, session.userId);
    if (!task) return jsonError("Task not found", 404);

    let cycle = null;
    if (cycleId !== null) {
      if (!task.project.cyclesEnabled) {
        return jsonError("Cycles are disabled for this board", 409);
      }
      const overview = await getProjectCycleOverview(task.projectId);
      if (cycleId !== overview?.current?.id && cycleId !== overview?.next?.id) {
        return jsonError("Only the current or next cycle can be assigned", 400);
      }
      cycle = cycleId === overview.current?.id ? overview.current : overview.next;
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return unauthorized();
    const result = await updateTaskSingle(
      { id: task.id, cycleId },
      user as unknown as IUser,
    );
    if (result.status !== 200) {
      return jsonError(result.json?.message ?? "Unable to update cycle", result.status);
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
