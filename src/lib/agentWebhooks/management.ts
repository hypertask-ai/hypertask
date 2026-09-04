import crypto from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { AGENT_SDK_FEATURE_FLAG } from "@/lib/agentRuns/model";
import { assertSafeWebhookTarget } from "@/lib/mcp/webhooks/ssrfGuard";
import { isAgentOnBoard } from "@/utils/controllers/agents/boardMembers";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  AGENT_WEBHOOK_DELIVERY_CONTRACT,
  availableAgentWebhookEventDefinitions,
  availableAgentWebhookEvents,
  parseAgentWebhookEvents,
} from "./events";
import {
  createAgentWebhookTestDelivery,
  replayAgentWebhookDelivery,
} from "./outbox";

const AGENT_WEBHOOK_TRANSACTION_TIMEOUT_MS = 10_000;

export class AgentWebhookInputError extends Error {
  constructor(
    message: string,
    readonly field?: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function serializeAgentWebhookSubscription(sub: {
  id: string;
  agentId: string;
  projectId: number | null;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastDeliveryAt: Date | null;
  lastDeliveryOk: boolean | null;
}) {
  return {
    id: sub.id,
    agentId: sub.agentId,
    projectId: sub.projectId,
    url: sub.url,
    events: sub.events,
    active: sub.active,
    secretHint: `whsec_…${sub.secret.slice(-4)}`,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    lastDeliveryAt: sub.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryOk: sub.lastDeliveryOk,
  };
}

export function serializeAgentWebhookDelivery(delivery: {
  id: string;
  event: string;
  status: string;
  attemptCount: number;
  statusCode: number | null;
  error: string | null;
  createdAt: Date;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
}) {
  return {
    id: delivery.id,
    event: delivery.event,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    statusCode: delivery.statusCode,
    error: delivery.error,
    createdAt: delivery.createdAt.toISOString(),
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
  };
}

export async function assertAgentWebhookOwner(userId: number, agentId: string) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId, revokedAt: null },
    select: { id: true },
  });
  if (!agent) {
    throw new AgentWebhookInputError("Agent not found or access denied", undefined, 404);
  }
  return agent;
}

export async function validateAgentWebhookProject(input: {
  userId: number;
  agentId: string;
  projectId: number | null;
}) {
  if (input.projectId == null) return;
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
    throw new AgentWebhookInputError("projectId must be a positive integer or null", "projectId");
  }
  const [project, onBoard] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, ...getProjectWhere(input.userId) },
      select: { id: true },
    }),
    isAgentOnBoard(input.projectId, input.agentId),
  ]);
  if (!project || !onBoard) {
    throw new AgentWebhookInputError(
      "The agent must be a member of the selected project",
      "projectId",
    );
  }
}

export async function upsertAgentWebhook(input: {
  userId: number;
  agentId: string;
  body: Record<string, unknown>;
}) {
  await assertAgentWebhookOwner(input.userId, input.agentId);
  const runsEnabled = await isFeatureEnabled(
    AGENT_SDK_FEATURE_FLAG,
    input.userId,
  );
  const availableEvents = availableAgentWebhookEvents(runsEnabled);
  const eventDefinitions = availableAgentWebhookEventDefinitions(runsEnabled);

  const rawUrl = input.body.url;
  const requestedUrl = typeof rawUrl === "string" ? rawUrl.trim() : undefined;
  if (requestedUrl !== undefined) {
    if (!requestedUrl) throw new AgentWebhookInputError("url is required", "url");
    if (requestedUrl.length > 2000) {
      throw new AgentWebhookInputError("url must be 2000 characters or less", "url");
    }
    try {
      if (new URL(requestedUrl).protocol !== "https:") {
        throw new AgentWebhookInputError("url must use HTTPS", "url");
      }
    } catch (error) {
      if (error instanceof AgentWebhookInputError) throw error;
      throw new AgentWebhookInputError("url must be a valid HTTPS URL", "url");
    }
    const safe = await assertSafeWebhookTarget(requestedUrl);
    if (!safe.ok) throw new AgentWebhookInputError(safe.reason, "url");
  }

  if (input.body.events !== undefined) {
    const parsedEvents = parseAgentWebhookEvents(
      input.body.events,
      availableEvents,
    );
    if (!parsedEvents.ok) {
      throw new AgentWebhookInputError(parsedEvents.error, "events");
    }
  }

  const requestedProjectId =
    input.body.projectId === undefined
      ? undefined
      : input.body.projectId === null
        ? null
        : Number(input.body.projectId);
  if (requestedProjectId !== undefined) {
    await validateAgentWebhookProject({
      userId: input.userId,
      agentId: input.agentId,
      projectId: requestedProjectId,
    });
  }

  if (input.body.active !== undefined && typeof input.body.active !== "boolean") {
    throw new AgentWebhookInputError("active must be a boolean", "active");
  }

  // The agent row exists before a subscription is created, so its stable ID is
  // also a lock key for the create path. Reading the current subscription only
  // after this transaction-scoped lock prevents concurrent first-time
  // configure calls from generating two secrets and returning the losing one.
  // Explicit rotations are serialized in the same order they commit.
  const transactionLockId = crypto
    .createHash("sha256")
    .update(`agent-webhook:${input.agentId}`)
    .digest()
    .readBigInt64BE(0);
  const { subscription, rotateSecret, secret } = await prisma.$transaction(
    async (tx) => {
      // Execute the lock for its side effect. `$executeRaw` does not deserialize
      // PostgreSQL's void result, and the transaction releases the lock even if
      // validation or the upsert throws.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${transactionLockId})`,
      );
      const existing = await tx.agentWebhookSubscription.findUnique({
        where: { agentId: input.agentId },
      });
      const url = requestedUrl ?? existing?.url ?? "";
      if (!url) throw new AgentWebhookInputError("url is required", "url");

      const parsedEvents =
        input.body.events === undefined && existing
          ? { ok: true as const, events: existing.events }
          : parseAgentWebhookEvents(input.body.events, availableEvents);
      if (!parsedEvents.ok) {
        throw new AgentWebhookInputError(parsedEvents.error, "events");
      }
      const projectId =
        requestedProjectId === undefined
          ? existing?.projectId ?? null
          : requestedProjectId;
      const active =
        typeof input.body.active === "boolean"
          ? input.body.active
          : existing?.active ?? true;
      const rotateSecret = input.body.rotateSecret === true || !existing;
      const secret = rotateSecret
        ? `whsec_${crypto.randomBytes(24).toString("hex")}`
        : existing.secret;
      const subscription = await tx.agentWebhookSubscription.upsert({
        where: { agentId: input.agentId },
        create: {
          agentId: input.agentId,
          projectId,
          url,
          events: parsedEvents.events,
          active,
          secret,
        },
        update: {
          projectId,
          url,
          events: parsedEvents.events,
          active,
          ...(rotateSecret ? { secret } : {}),
        },
      });
      return { subscription, rotateSecret, secret };
    },
    { timeout: AGENT_WEBHOOK_TRANSACTION_TIMEOUT_MS },
  );

  return {
    subscription: {
      ...serializeAgentWebhookSubscription(subscription),
      events: subscription.events.filter((event) =>
        availableEvents.includes(event as (typeof availableEvents)[number]),
      ),
    },
    ...(rotateSecret ? { secret } : {}),
    availableEvents,
    eventDefinitions,
    deliveryContract: AGENT_WEBHOOK_DELIVERY_CONTRACT,
  };
}

export type AgentWebhookManagementAction =
  | "get"
  | "configure"
  | "test"
  | "replay"
  | "rotate"
  | "delete";

export async function manageAgentWebhook(input: {
  userId: number;
  agentId: string;
  action: AgentWebhookManagementAction;
  url?: unknown;
  projectId?: unknown;
  events?: unknown;
  active?: unknown;
  deliveryId?: unknown;
}) {
  await assertAgentWebhookOwner(input.userId, input.agentId);

  if (input.action === "configure" || input.action === "rotate") {
    return {
      success: true,
      scope: "agent" as const,
      ...(await upsertAgentWebhook({
        userId: input.userId,
        agentId: input.agentId,
        body: {
          url: input.url,
          projectId: input.projectId,
          events: input.events,
          active: input.active,
          rotateSecret: input.action === "rotate",
        },
      })),
    };
  }

  const subscription = await prisma.agentWebhookSubscription.findUnique({
    where: { agentId: input.agentId },
    include: {
      deliveries: { orderBy: { createdAt: "desc" }, take: 25 },
    },
  });

  if (input.action === "get") {
    const runsEnabled = await isFeatureEnabled(
      AGENT_SDK_FEATURE_FLAG,
      input.userId,
    );
    const availableEvents = availableAgentWebhookEvents(runsEnabled);
    const eventDefinitions = availableAgentWebhookEventDefinitions(runsEnabled);
    return {
      success: true,
      scope: "agent" as const,
      agentId: input.agentId,
      availableEvents,
      eventDefinitions,
      deliveryContract: AGENT_WEBHOOK_DELIVERY_CONTRACT,
      subscription: subscription
        ? {
            ...serializeAgentWebhookSubscription(subscription),
            events: subscription.events.filter((event) =>
              availableEvents.includes(event as (typeof availableEvents)[number]),
            ),
          }
        : null,
      deliveries: subscription
        ? subscription.deliveries
            .filter(
              ({ event }) =>
                event === "webhook.test" ||
                availableEvents.includes(
                  event as (typeof availableEvents)[number],
                ),
            )
            .map(serializeAgentWebhookDelivery)
        : [],
    };
  }

  if (!subscription) {
    throw new AgentWebhookInputError("Webhook is not configured", undefined, 404);
  }

  if (input.action === "delete") {
    await prisma.agentWebhookSubscription.delete({ where: { id: subscription.id } });
    return { success: true, scope: "agent" as const, deleted: subscription.id };
  }

  if (input.action === "test") {
    if (!subscription.active) {
      throw new AgentWebhookInputError(
        "Enable delivery before sending a test",
        "active",
      );
    }
    const deliveryId = await createAgentWebhookTestDelivery({
      subscriptionId: subscription.id,
      agentId: input.agentId,
      projectId: subscription.projectId,
    });
    return {
      success: true,
      scope: "agent" as const,
      deliveryId,
      message: "Test delivery queued",
    };
  }

  const sourceDeliveryId =
    typeof input.deliveryId === "string" ? input.deliveryId.trim() : "";
  if (!sourceDeliveryId) {
    throw new AgentWebhookInputError("deliveryId is required", "deliveryId");
  }
  const deliveryId = await replayAgentWebhookDelivery({
    deliveryId: sourceDeliveryId,
    subscriptionId: subscription.id,
  });
  if (!deliveryId) {
    throw new AgentWebhookInputError("Delivery not found", undefined, 404);
  }
  return {
    success: true,
    scope: "agent" as const,
    deliveryId,
    message: "Delivery queued again",
  };
}
