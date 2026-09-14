import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseMyTasksViewConfig } from "@/models/MyTasksView";
import {
  myTasksViewSelect,
  serializeMyTasksView,
} from "@/utils/controllers/tasks/myTasksViews";
import { authorizeMyTasksViewsRequest } from "../auth";

export const runtime = "nodejs";

const databaseId = (value: string): number | null => {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
};

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ viewId: string }> },
) {
  try {
    const auth = await authorizeMyTasksViewsRequest(request);
    if ("response" in auth) return auth.response;
    const viewId = databaseId((await params).viewId);
    if (!viewId) {
      return NextResponse.json({ error: "A valid view id is required" }, { status: 400 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });
    }

    const data: Prisma.MyTasksViewUpdateManyMutationInput = {};
    if (hasOwn(body, "name")) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 80) {
        return NextResponse.json(
          { error: "A view name between 1 and 80 characters is required" },
          { status: 400 },
        );
      }
      data.name = name;
    }
    if (hasOwn(body, "config")) {
      data.config = parseMyTasksViewConfig(body.config) as unknown as Prisma.InputJsonValue;
    }
    if (hasOwn(body, "position")) {
      if (
        !Number.isSafeInteger(body.position) ||
        body.position < 0 ||
        body.position > 2_147_483_647
      ) {
        return NextResponse.json(
          { error: "position must be a non-negative 32-bit integer" },
          { status: 400 },
        );
      }
      data.position = body.position;
    }
    if (hasOwn(body, "isDefault")) {
      if (typeof body.isDefault !== "boolean") {
        return NextResponse.json({ error: "isDefault must be boolean" }, { status: 400 });
      }
      data.isDefault = body.isDefault;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No supported fields supplied" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.myTasksView.findFirst({
        where: { id: viewId, userId: auth.userId },
        select: { id: true },
      });
      if (!existing) return null;
      if (data.isDefault === true) {
        await tx.myTasksView.updateMany({
          where: { userId: auth.userId, isDefault: true, id: { not: viewId } },
          data: { isDefault: false },
        });
      }
      return tx.myTasksView.update({
        where: { id: viewId },
        data,
        select: myTasksViewSelect,
      });
    });
    if (!updated) return NextResponse.json({ error: "View not found" }, { status: 404 });
    return NextResponse.json({ view: serializeMyTasksView(updated) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Another view was set as default; try again" },
        { status: 409 },
      );
    }
    console.error("[my-tasks-views] update failed", error);
    return NextResponse.json({ error: "Unable to update view" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ viewId: string }> },
) {
  try {
    const auth = await authorizeMyTasksViewsRequest(request);
    if ("response" in auth) return auth.response;
    const viewId = databaseId((await params).viewId);
    if (!viewId) {
      return NextResponse.json({ error: "A valid view id is required" }, { status: 400 });
    }

    const result = await prisma.myTasksView.deleteMany({
      where: { id: viewId, userId: auth.userId },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "View not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[my-tasks-views] delete failed", error);
    return NextResponse.json({ error: "Unable to delete view" }, { status: 500 });
  }
}
