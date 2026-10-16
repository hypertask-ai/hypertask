import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { isOAuthAccessTokenPayload, oauthClientIdFromPayload } from "@/lib/mcp/oauthTokenContract";
import { HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { LogType, Prisma, Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { identifyMcpCli } from "@/lib/mcp/clientTelemetry";
import type { ActivationEvent } from "./activationAnalytics";
import { postHogClient, scheduleAnalytics } from "./signupAnalytics";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";

const connectionHistory = {
  OR: [{ log: { startsWith: "cli_token_exchange" } }, { log: { startsWith: "mcp_connected" } }],
};

export function recordActivationOccurrence(
  userId: number,
  event: ActivationEvent,
  occurrence: string,
  props: Record<string, unknown>,
  completionTime?: Date,
): void {
  const completedAt = event === "agent_task_completed" ? completionTime ?? new Date() : undefined;
  scheduleAnalytics(() => captureActivationOccurrence(userId, event, occurrence, props, completedAt));
}

export async function captureActivationOccurrence(
  userId: number,
  event: ActivationEvent,
  occurrence: string,
  props: Record<string, unknown>,
  completedAt?: Date,
): Promise<void> {
  const { isActivationEligible } = await import("./activationAnalytics");
  if (!(await isActivationEligible(userId))) return;
  const marker = `activation:${event}:${occurrence}`;
  await captureAnalyticsOccurrence(userId, event, marker, async (tx) => {
    const previous = event === "agent_task_completed"
      ? await tx.logs.findFirst({ where: { LoggedById: userId, log: { startsWith: "activation:agent_task_completed:" }, createdAt: { lt: completedAt } } })
      : null;
    const historicalCompletion = event === "agent_task_completed" && !previous
      ? await hasHistoricalAgentCompletion(tx, userId, completedAt)
      : false;
    return event === "agent_task_completed" ? { ...props, is_first: !previous && !historicalCompletion } : props;
  }, { createdAt: completedAt });
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
  connectionKey?: string,
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
      if (!postHogClient()) {
        seenConnections.delete(cacheKey);
        return;
      }
      const durable = await isFeatureEnabled(HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG, userId);
      const agentType = identifyMcpCli(clientName ?? null) ? "hypertask_cli" : activationClient(clientName);
      let key = connectionKey;
      if (durable && !key) {
        const decoded = jwt.decode(token);
        const oauth = decoded && typeof decoded !== "string" && isOAuthAccessTokenPayload(decoded) ? decoded : null;
        const clientId = oauth ? oauthClientIdFromPayload(oauth) : null;
        key = oauth && typeof oauth.agentId === "string" && oauth.agentId
          ? `agent:${oauth.agentId}`
          : clientId ? `oauth_client:${clientId}` : `user_token:${transport}:${agentType}`;
      }
      const connectionId = durable ? createHash("sha256").update(`hypertask:connection:${userId}:${key}`).digest("hex").slice(0, 32) : null;
      const legacyMarker = `activation:agent_connected:${fingerprint}`;
      const marker = connectionId ? `activation:agent_connected:connection:${connectionId}` : legacyMarker;
      if (connectionId && await claimConnectionCountedBeforeRollout(userId, legacyMarker, marker)) return;
      await captureAnalyticsOccurrence(userId, "agent_connected", marker, async (tx) => {
        const previous = await tx.logs.findFirst({ where: { LoggedById: userId, OR: [
          { log: { startsWith: "activation:agent_connected:" } },
          { ...connectionHistory, createdAt: { lt: connectedAt } },
        ] } });
        return {
          ...(connectionId ? {
            ...serverAnalyticsProperties(userId, null, null, `agent_connected:${connectionId}`, connectedAt),
            connection_id: connectionId, agent_type: agentType,
          } : {}),
          client: activationClient(clientName), transport, is_first: !previous,
        };
      }, connectionId ? { occurredAt: connectedAt } : undefined);
    } catch {
      seenConnections.delete(cacheKey);
    }
  });
}

async function claimConnectionCountedBeforeRollout(userId: number, legacyMarker: string, marker: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7034::int, ${userId}::int)`;
    const [legacy, durable] = await Promise.all([
      tx.logs.findFirst({ where: { LoggedById: userId, log: legacyMarker }, select: { id: true } }),
      tx.logs.findFirst({ where: { LoggedById: userId, log: marker }, select: { id: true } }),
    ]);
    if (!legacy) return false;
    if (!durable) await tx.logs.create({ data: { log: marker, LoggedById: userId, type: LogType.Signup, status: Status.Normal } });
    return true;
  });
}

export function recordAuthenticatedConnection(request: Pick<Request, "headers" | "url">, userId: number, token: string, connectedAt?: Date, connectionKey?: string): void {
  const decoded = jwt.decode(token);
  if (decoded && typeof decoded !== "string" && isOAuthAccessTokenPayload(decoded)) return;
  const userAgent = request.headers.get("user-agent");
  const transport = identifyMcpCli(userAgent) ? "cli" : /^\/(mcp|sse)(\/|$)/.test(new URL(request.url).pathname) ? "mcp" : "api";
  recordAgentConnection(userId, token, transport, userAgent, connectedAt, connectionKey);
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
