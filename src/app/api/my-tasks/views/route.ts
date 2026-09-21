import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseMyTasksViewConfig } from "@/models/MyTasksView";
import {
  getMyTasksViews,
  MAX_MY_TASKS_VIEWS,
  myTasksViewSelect,
  serializeMyTasksView,
} from "@/utils/controllers/tasks/myTasksViews";
import { authorizeMyTasksViewsRequest } from "./auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MY_TASKS_VIEW_CREATE_LOCK_NAMESPACE = 6_422;

async function GETHandler(request: NextRequest) {
  try {
    const auth = await authorizeMyTasksViewsRequest(request);
    if ("response" in auth) return auth.response;
    return NextResponse.json({ views: await getMyTasksViews(auth.userId) });
  } catch (error) {
    htLogger.error("[my-tasks-views] list failed", error);
    return NextResponse.json({ error: "Unable to load views" }, { status: 500 });
  }
}

async function POSTHandler(request: NextRequest) {
  try {
    const auth = await authorizeMyTasksViewsRequest(request);
    if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) {
      return NextResponse.json(
        { error: "A view name between 1 and 80 characters is required" },
        { status: 400 },
      );
    }

    const view = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          ${MY_TASKS_VIEW_CREATE_LOCK_NAMESPACE}::int,
          ${auth.userId}::int
        )
      `;
      const aggregate = await tx.myTasksView.aggregate({
        where: { userId: auth.userId },
        _count: true,
        _max: { position: true },
      });
      if (aggregate._count >= MAX_MY_TASKS_VIEWS) return null;
      return tx.myTasksView.create({
        data: {
          userId: auth.userId,
          name,
          position: (aggregate._max.position ?? -1) + 1,
          config: parseMyTasksViewConfig(body?.config) as unknown as Prisma.InputJsonValue,
        },
        select: myTasksViewSelect,
      });
    });
    if (!view) {
      return NextResponse.json(
        { error: `You can save up to ${MAX_MY_TASKS_VIEWS} My Tasks views` },
        { status: 400 },
      );
    }
    return NextResponse.json({ view: serializeMyTasksView(view) }, { status: 201 });
  } catch (error) {
    htLogger.error("[my-tasks-views] create failed", error);
    return NextResponse.json({ error: "Unable to create view" }, { status: 500 });
  }
}

export const GET = withAuth(GETHandler, { authenticateInHandler: true });
export const POST = withAuth(POSTHandler, { authenticateInHandler: true });
