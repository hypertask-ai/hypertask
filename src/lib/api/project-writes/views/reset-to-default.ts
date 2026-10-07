import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import getProjectView from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { Prisma } from "@prisma/client";

type ResetMode = "ResetCurrent" | "ResetToDefault";
const SERIALIZABLE_ATTEMPTS = 3;

class ViewResetAccessError extends Error {}

const isResetMode = (value: unknown): value is ResetMode =>
  value === "ResetCurrent" || value === "ResetToDefault";

export async function resetUserProjectViewState(
  tx: Prisma.TransactionClient,
  projectViewId: string,
  userId: number,
  mode: ResetMode,
) {
  const key = {
    userId,
    project_view_id: projectViewId,
  };

  // Ensure the row exists, then lock it before reading the transient view.
  // A concurrent editor's update must now complete before this read or wait
  // until the reset commits, so we never clear a newer unsaved view while
  // deleting the stale one captured earlier.
  await tx.user_Project_View.upsert({
    where: { user_project: key },
    create: {
      ...key,
      appliedViewId: null,
      unsavedViewId: null,
    },
    update: {},
  });
  const [existing] = await tx.$queryRaw<
    Array<{ unsavedViewId: string | null }>
  >(
    Prisma.sql`SELECT "unsavedViewId" FROM "User_Project_View" WHERE "userId" = ${userId} AND "project_view_id" = ${projectViewId} FOR UPDATE`,
  );
  if (!existing) throw new Error("Unable to lock user view state");

  // Detach the transient view before deleting it. The previous route left
  // unsavedViewId pointing at the row and then deleted that row, which can
  // fail with a foreign-key violation.
  await tx.user_Project_View.update({
    where: { user_project: key },
    data: {
      unsavedViewId: null,
      ...(mode === "ResetToDefault" ? { appliedViewId: null } : {}),
    },
  });

  if (existing?.unsavedViewId) {
    await tx.view_Last_Used.deleteMany({
      where: { viewId: existing.unsavedViewId },
    });
    await tx.view.deleteMany({
      where: {
        id: existing.unsavedViewId,
        userId,
        project_view_id: projectViewId,
      },
    });
  }
}

export async function runSerializableViewReset(
  projectId: number,
  userId: number,
  mode: ResetMode,
  database: Pick<typeof prisma, "$transaction"> = prisma,
) {
  for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      await database.$transaction(
        async (tx) => {
          const accessibleProject = await tx.project.findFirst({
            where: {
              id: projectId,
              OR: [
                { ownerId: userId },
                { members: { some: { userId, status: "Accepted" } } },
              ],
            },
            select: { id: true },
          });
          if (!accessibleProject) throw new ViewResetAccessError();

          const projectView = await tx.project_View.upsert({
            where: { projectId },
            create: { projectId },
            update: {},
          });
          await resetUserProjectViewState(tx, projectView.id, userId, mode);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return;
    } catch (error) {
      if (
        (error as { code?: string })?.code !== "P2034" ||
        attempt === SERIALIZABLE_ATTEMPTS - 1
      ) {
        throw error;
      }
    }
  }
}


const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const projectId = Number(req.body?.projectId);
    const mode = req.body?.mode;
    if (!Number.isInteger(projectId) || projectId <= 0 || !isResetMode(mode)) {
      return viewWriteJson({ message: "A valid board and reset mode are required" }, 400);
    }

    const userId = session.userId;

    try {
      await runSerializableViewReset(projectId, userId, mode);

      const projectViewUpdated = await getProjectView(projectId, userId);
      broadcastBoardChange(projectId, { originUserId: userId });
      return viewWriteJson(projectViewUpdated, 200);
    } catch (error) {
      if (error instanceof ViewResetAccessError) {
        return viewWriteJson({ message: "Board access required" }, 403);
      }
      console.error("reset active view failed", error);
      return viewWriteJson({ message: "Unable to reset the active view" }, 500);
    }

  },
});

const authenticated: TaskWriteRoute = async (request, session) => {
  session ??= (await getSessionUser(request.headers)) ?? undefined;
  if (!session) return viewWriteJson({ message: "Authentication required" }, 401);
  return route(request, session);
};

export const POST = authenticated;
