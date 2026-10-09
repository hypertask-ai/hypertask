import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { isOAuthAccessTokenPayload } from "@/lib/mcp/oauthTokenContract";
import { LogType, Prisma, Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { identifyMcpCli } from "@/lib/mcp/clientTelemetry";
import type { ActivationEvent } from "./activationAnalytics";
import { postHogClient, scheduleAnalytics } from "./signupAnalytics";

function activationUuid(userId: number, marker: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex"))
    .update(`hypertask:activation:${userId}:${marker}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const connectionHistory = {
  OR: [{ log: { startsWith: "cli_token_exchange" } }, { log: { startsWith: "mcp_connected" } }],
};

// Logs plus a user lock survive cold starts and concurrent serverless requests.
export function recordActivationOccurrence(
  userId: number,
  event: ActivationEvent,
  occurrence: string,
  props: Record<string, unknown>,
  completionTime?: Date,
): void {
  const completedAt = event === "agent_task_completed" ? completionTime ?? new Date() : undefined;
  scheduleAnalytics(async () => {
    const { isActivationEligible } = await import("./activationAnalytics");
    if (!(await isActivationEligible(userId))) return;
    const client = postHogClient();
    if (!client) return;
    // Completion occurrence is the task id: reopen and recomplete never re-fire.
    const marker = `activation:${event}:${occurrence}`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7034::int, ${userId}::int)`;
      if (await tx.logs.findFirst({ where: { LoggedById: userId, log: marker } })) return null;
      const previous = event === "agent_task_completed"
        ? await tx.logs.findFirst({ where: { LoggedById: userId, log: { startsWith: "activation:agent_task_completed:" }, createdAt: { lt: completedAt } } })
        : null;
      const historicalCompletion = event === "agent_task_completed" && !previous
        ? await hasHistoricalAgentCompletion(tx, userId, completedAt)
        : false;
      await client.captureImmediate({
        distinctId: String(userId), event, uuid: activationUuid(userId, marker),
        properties: event === "agent_task_completed" ? { ...props, is_first: !previous && !historicalCompletion } : props,
      });
      await tx.logs.create({ data: { log: marker, LoggedById: userId, type: LogType.Signup, status: Status.Normal, ...(completedAt ? { createdAt: completedAt } : {}) } });
    }, { timeout: 20000, maxWait: 1500 });
  });
}

async function hasHistoricalAgentCompletion(tx: Prisma.TransactionClient, ownerId: number, before?: Date): Promise<boolean> {
  const rows = await tx.comment.findMany({
    where: {
      task: { project: { ownerId } },
      ...(before ? { createdAt: { lt: before } } : {}),
      OR: [
        { activity: { path: ["type"], equals: "TaskMove" } },
        { activity: { path: ["type"], equals: "TaskArchive" } },
      ],
    },
    select: { activity: true },
  });
  const activities = rows.map((row) => row.activity as {
    type?: string;
    data?: { fromAgent?: { id?: string }; newStatus?: string; toSection?: { sectionId?: number; sectionTitle?: string } };
  } | null).filter((activity) => activity?.data?.fromAgent?.id);
  if (activities.some((activity) => activity?.type === "TaskArchive" && activity.data?.newStatus === "Archive")) return true;
  const sectionIds = activities.map((activity) => activity?.data?.toSection?.sectionId).filter((id): id is number => typeof id === "number");
  const sections = sectionIds.length ? await tx.section.findMany({
    where: { id: { in: sectionIds } }, select: { id: true, section_title: true, isDone: true },
  }) : [];
  return activities.some((activity) => {
    const destination = activity?.data?.toSection;
    if (!destination) return false;
    const section = sections.find((section) => section.id === destination.sectionId);
    return columnRoleFor(section ?? { section_title: destination.sectionTitle ?? "" }) === "done";
  });
}

export function activationClient(name: string | null | undefined): "claude_code" | "cursor" | "codex" | "other" {
  const normalized = name?.toLowerCase() ?? "";
  if (/claude[ _-]?code/.test(normalized)) return "claude_code";
  if (normalized.includes("cursor")) return "cursor";
  if (normalized.includes("codex")) return "codex";
  return "other";
}

const seenConnections = new Set<string>();

export function recordAgentConnection(
  userId: number,
  token: string,
  transport: "mcp" | "cli" | "api",
  clientName?: string | null,
  connectedAt = new Date(),
): void {
  const fingerprint = createHash("sha256").update(token).digest("hex");
  const cacheKey = `${userId}:${fingerprint}`;
  if (seenConnections.has(cacheKey)) return;
  if (seenConnections.size >= 1000) seenConnections.delete(seenConnections.values().next().value!);
  seenConnections.add(cacheKey);
  scheduleAnalytics(async () => {
    try {
      const { isActivationEligible } = await import("./activationAnalytics");
      if (!(await isActivationEligible(userId))) {
        seenConnections.delete(cacheKey);
        return;
      }
      const client = postHogClient();
      if (!client) {
        seenConnections.delete(cacheKey);
        return;
      }
      const marker = `activation:agent_connected:${fingerprint}`;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7034::int, ${userId}::int)`;
        if (await tx.logs.findFirst({ where: { LoggedById: userId, log: marker } })) return;
        const previous = await tx.logs.findFirst({ where: { LoggedById: userId, OR: [
          { log: { startsWith: "activation:agent_connected:" } },
          // The status row for this request is not a previous connection.
          { ...connectionHistory, createdAt: { lt: connectedAt } },
        ] } });
        await client.captureImmediate({
          distinctId: String(userId), event: "agent_connected", uuid: activationUuid(userId, marker),
          properties: { client: activationClient(clientName), transport, is_first: !previous },
        });
        await tx.logs.create({ data: {
          log: marker, LoggedById: userId, type: LogType.Signup, status: Status.Normal,
        } });
      }, { timeout: 20000, maxWait: 1500 });
    } catch {
      seenConnections.delete(cacheKey);
    }
  });
}

export function recordAuthenticatedConnection(request: Pick<Request, "headers" | "url">, userId: number, token: string, connectedAt?: Date): void {
  // OAuth connections are recorded at code exchange, not on token refresh/use.
  const decoded = jwt.decode(token);
  if (decoded && typeof decoded !== "string" && isOAuthAccessTokenPayload(decoded)) return;
  const userAgent = request.headers.get("user-agent");
  const transport = identifyMcpCli(userAgent) ? "cli" : /^\/(mcp|sse)(\/|$)/.test(new URL(request.url).pathname) ? "mcp" : "api";
  recordAgentConnection(userId, token, transport, userAgent, connectedAt);
}

type TaskState = { id: number; projectId: number; sectionId: number | null; section: string | null; status: Status; updatedAt?: Date | null };

export function recordAgentTaskCompletion(before: TaskState, after: TaskState, agentId?: string | null): void {
  if (!agentId || after.status === Status.Deleted || (before.sectionId === after.sectionId && before.section === after.section && before.status === after.status)) return;
  const completedAt = after.updatedAt ?? new Date();
  scheduleAnalytics(async () => {
    const project = await prisma.project.findUnique({ where: { id: after.projectId }, select: { ownerId: true } });
    const { isActivationEligible } = await import("./activationAnalytics");
    if (!project || !(await isActivationEligible(project.ownerId))) return;
    const sections = await prisma.section.findMany({ where: { id: { in: [before.sectionId, after.sectionId].filter((id): id is number => id !== null) } }, select: { id: true, section_title: true, isDone: true } });
    const done = (task: TaskState) => task.status === Status.Archive || columnRoleFor(
      sections.find((section) => section.id === task.sectionId) ?? { section_title: task.section ?? "" },
    ) === "done";
    if (done(before) || !done(after)) return;
    recordActivationOccurrence(project.ownerId, "agent_task_completed", String(after.id), { taskId: after.id, projectId: after.projectId }, completedAt);
  });
}
