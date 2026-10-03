import { SortingMode } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { upsertAllCommentsToTurbopuffer, upsertTaskToTurbopuffer } from "../turbopuffer/turbopufferHelper";
import prisma from "@/lib/prisma";
import { HTPR_6868_TICKET_PREFIX_FLAG, isFeatureEnabled } from "@/lib/flags";
import { normalizeProjectPrefix } from "@/lib/projectPrefix";
import { IUser } from "@/models/model";
import { taskWriteAccessWhere } from "./getAllIncludes";

export async function changeProjectPrefix(
  projectId: number,
  input: unknown,
  currentUser: IUser,
  agentId?: string | null,
  settings: { title?: string; sorting_mode?: SortingMode } = {},
) {
  if (!(await isFeatureEnabled(HTPR_6868_TICKET_PREFIX_FLAG, currentUser.id))) {
    return { status: 403, json: { message: "Ticket prefix changes are not enabled" } };
  }
  const prefix = normalizeProjectPrefix(input);
  const accessWhere = taskWriteAccessWhere(currentUser.id, agentId);
  const project = await prisma.$transaction(async (tx) => {
    // Share task creation's board lock and serialize team-wide prefix claims.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(9428471::int, ${projectId}::int)`;
    const board = await tx.project.findFirst({
      where: { id: projectId, status: { not: "Deleted" }, ...accessWhere },
      select: { id: true, teamId: true, uniqueIdentifier: true },
    });
    if (!board) return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${board.teamId ?? "teamless"}))`;
    const clash = await tx.project.findFirst({
      where: {
        teamId: board.teamId,
        id: { not: projectId },
        OR: [
          { uniqueIdentifier: { equals: prefix, mode: "insensitive" }, status: { not: "Deleted" } },
          { prefixAliases: { some: { prefix: { equals: prefix, mode: "insensitive" } } } },
        ],
      },
      select: { id: true },
    });
    if (clash) throw new Error("Ticket prefix is already used by another board in this team");
    const previousPrefix = board.uniqueIdentifier?.toUpperCase();
    if (previousPrefix && previousPrefix !== prefix) {
      await tx.projectPrefixAlias.upsert({
        where: { projectId_prefix: { projectId, prefix: previousPrefix } },
        create: { projectId, prefix: previousPrefix },
        update: {},
      });
    }
    await tx.project.update({
      where: { id: projectId, status: { not: "Deleted" }, AND: accessWhere },
      data: { ...settings, uniqueIdentifier: prefix },
    });
    await tx.$executeRaw`UPDATE "Task" SET "ticketNumber" = ${prefix} || '-' || "uniqueIndex", "updatedAt" = CURRENT_TIMESTAMP WHERE "projectId" = ${projectId}`;
    return tx.project.findUnique({ where: { id: projectId }, include: { tasks: true } });
  });
  if (!project) return { status: 403, json: { message: "Not allowed to edit this board" } };
  waitUntil(Promise.all(project.tasks.map(task => Promise.all([
    upsertTaskToTurbopuffer(task.id),
    upsertAllCommentsToTurbopuffer(task.id),
  ]))).catch(error => console.error("Ticket prefix search reindex failed", error)));
  return { status: 200, json: project };
}

const updateProject = async (
  projectId: number,
  title: unknown,
  sorting_mode: SortingMode | undefined,
  uniqueIdentifier: unknown,
  currentUser: IUser,
  agentId?: string | null,
) => {
  try {
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      return { status: 400, json: { message: "projectId must be a positive integer" } };
    }
    if (title === undefined && sorting_mode === undefined && uniqueIdentifier !== undefined) {
      return await changeProjectPrefix(projectId, uniqueIdentifier, currentUser, agentId);
    }
    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    if (!trimmedTitle || trimmedTitle.length > 200) {
      return { status: 400, json: { message: "projectId must be a positive integer and title must be between 1 and 200 characters" } };
    }
    const exists = await prisma.project.findFirst({
      where: { id: projectId, status: { not: "Deleted" } },
      select: { id: true, uniqueIdentifier: true },
    });
    if (!exists) return { status: 404, json: { message: "Board not found" } };
    const accessWhere = taskWriteAccessWhere(currentUser.id, agentId);
    const allowed = await prisma.project.findFirst({
      where: { id: projectId, status: { not: "Deleted" }, ...accessWhere },
      select: { id: true },
    });
    if (!allowed) return { status: 403, json: { message: "Not allowed to rename this board" } };
    if (uniqueIdentifier != null && uniqueIdentifier !== exists.uniqueIdentifier) {
      return await changeProjectPrefix(projectId, uniqueIdentifier, currentUser, agentId, {
        title: trimmedTitle,
        sorting_mode,
      });
    }
    const project = await prisma.project.update({
      where: { id: projectId, status: { not: "Deleted" }, AND: accessWhere },
      data: { title: trimmedTitle, sorting_mode },
      include: { tasks: true },
    });
    return { status: 200, json: project };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
      return { status: 403, json: { message: "Not allowed to rename this board" } };
    }
    return { status: 400, json: { message: error instanceof Error ? error.message : "Unable to update board" } };
  }
};

export default updateProject;
