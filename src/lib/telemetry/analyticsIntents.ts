import type { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { Stripe } from "stripe";
import prisma from "@/lib/prisma";
import type { BoardCreationMethod, CreationChannel, SavedWorkActor } from "./savedWork";
import type { AnalyticsSubscription } from "./stripeAnalytics";
import type { SignupCompletedPayload } from "./signupCompleted";
import type { InviteSentPayload, MemberJoinedPayload } from "./inviteAnalytics";
import type { AgentConnectionPayload, AgentTaskCompletionPayload } from "./activationOccurrences";

export type AnalyticsIntent =
  | { kind: "task_created"; payload: { taskId: number; actor: SavedWorkActor; channel: CreationChannel } }
  | { kind: "board_created"; payload: { boardId: number; method: BoardCreationMethod; actor: SavedWorkActor; occurredAt: string } }
  | { kind: "column_created" | "column_renamed"; payload: { columnId: number; actor: SavedWorkActor; occurredAt: string } }
  | { kind: "stripe_event"; payload: { eventId: string } }
  | { kind: "signup_completed"; payload: SignupCompletedPayload }
  | { kind: "invite_sent"; payload: InviteSentPayload }
  | { kind: "member_joined"; payload: MemberJoinedPayload }
  | { kind: "agent_connected"; payload: AgentConnectionPayload }
  | { kind: "agent_task_completed"; payload: AgentTaskCompletionPayload };

type Dependencies = { stripe?: Pick<Stripe, "events" | "subscriptions" | "invoices"> };
type ProcessingResult = "processed" | "failed" | "skipped";

const RETRY_DELAYS_MS = [60000, 300000, 1800000, 7200000, 43200000];
const LEASE_MS = 300000;
const DEFER_MS = 3600000;
const DEFER_MAX_AGE_MS = 7 * 86400000;

export class AnalyticsIntentDeferred extends Error {}

export async function enqueueAnalyticsIntent(db: Pick<Prisma.TransactionClient, "analyticsIntent">, intent: AnalyticsIntent): Promise<string> {
  let key: string;
  switch (intent.kind) {
    case "task_created": key = `task_created:${intent.payload.taskId}`; break;
    case "board_created": key = `board_created:${intent.payload.boardId}`; break;
    case "column_created": key = `column_created:${intent.payload.columnId}`; break;
    case "column_renamed": key = `column_renamed:${intent.payload.columnId}:${new Date(intent.payload.occurredAt).getTime()}`; break;
    case "stripe_event": key = `stripe_event:${intent.payload.eventId}`; break;
    case "signup_completed": key = `signup_completed:${intent.payload.userId}`; break;
    case "invite_sent": key = `invite_sent:${intent.payload.invite.id}`; break;
    case "member_joined": key = `member_joined:${intent.payload.membershipId}`; break;
    case "agent_connected": key = `agent_connected:${intent.payload.userId}:${intent.payload.fingerprint}`; break;
    case "agent_task_completed": key = `agent_task_completed:${intent.payload.after.id}:${new Date(intent.payload.completedAt).getTime()}`; break;
  }
  await db.analyticsIntent.createMany({ data: [{ key, kind: intent.kind, payload: intent.payload }], skipDuplicates: true });
  return key;
}

async function captureIntent(intent: AnalyticsIntent, dependencies: Dependencies): Promise<void> {
  if (intent.kind === "stripe_event") {
    const stripe = dependencies.stripe ?? new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
      apiVersion: "2023-08-16" as typeof Stripe.API_VERSION,
    });
    const event = await stripe.events.retrieve(intent.payload.eventId);
    const { captureStripeInvoicePaid, captureStripeSubscriptionEvent } = await import("./stripeAnalytics");
    if (event.type === "invoice.paid") {
      await captureStripeInvoicePaid(event, (id) => stripe.subscriptions.retrieve(id),
        (customer) => stripe.invoices.list({ customer, status: "paid", limit: 100 }));
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await captureStripeSubscriptionEvent(event, event.data.object as unknown as AnalyticsSubscription, event.data.previous_attributes);
    }
    return;
  }
  const analytics = await import("./savedWorkAnalytics");
  switch (intent.kind) {
    case "task_created":
      await analytics.captureTaskCreated(intent.payload.taskId, intent.payload.actor, intent.payload.channel);
      break;
    case "board_created":
      await analytics.captureBoardCreated(intent.payload.boardId, intent.payload.method, intent.payload.actor, new Date(intent.payload.occurredAt));
      break;
    case "column_created":
      await analytics.captureColumnCreated(intent.payload.columnId, "user", intent.payload.actor, new Date(intent.payload.occurredAt));
      break;
    case "column_renamed":
      await analytics.captureColumnRenamed(intent.payload.columnId, intent.payload.actor, new Date(intent.payload.occurredAt));
      break;
    case "signup_completed":
      await (await import("./signupCompleted")).captureSignupCompleted(intent.payload);
      break;
    case "invite_sent":
      await (await import("./inviteAnalytics")).captureInviteSent(intent.payload);
      break;
    case "member_joined":
      await (await import("./inviteAnalytics")).captureMemberJoined(intent.payload);
      break;
    case "agent_connected":
      await (await import("./activationOccurrences")).captureAgentConnection(intent.payload);
      break;
    case "agent_task_completed":
      await (await import("./activationOccurrences")).captureAgentTaskCompletion(intent.payload);
      break;
    default:
      throw new Error("Unknown analytics intent kind");
  }
}

export async function processAnalyticsIntent(key: string, dependencies: Dependencies = {}): Promise<ProcessingResult> {
  let lease: Date | undefined;
  let attempts = 0;
  let createdAt = new Date();
  try {
    const now = new Date();
    const leasedUntil = new Date(now.getTime() + LEASE_MS);
    const claimed = await prisma.analyticsIntent.updateMany({
      where: { key, processedAt: null, nextAttemptAt: { lte: now }, attempts: { lt: 10 } },
      data: { nextAttemptAt: leasedUntil },
    });
    if (!claimed.count) return "skipped";
    lease = leasedUntil;
    const row = await prisma.analyticsIntent.findUniqueOrThrow({ where: { key } });
    attempts = row.attempts;
    createdAt = row.createdAt;
    await captureIntent({ kind: row.kind, payload: row.payload } as AnalyticsIntent, dependencies);
    const processed = await prisma.analyticsIntent.updateMany({
      where: { key, processedAt: null, nextAttemptAt: lease },
      data: { processedAt: new Date(), lastError: null },
    });
    return processed.count ? "processed" : "skipped";
  } catch (error) {
    if (lease && error instanceof AnalyticsIntentDeferred) {
      const expired = Date.now() - createdAt.getTime() > DEFER_MAX_AGE_MS;
      try {
        await prisma.analyticsIntent.updateMany({
          where: { key, processedAt: null, nextAttemptAt: lease },
          data: expired
            ? { processedAt: new Date(), lastError: "Analytics intent expired while deferred" }
            : { nextAttemptAt: new Date(Date.now() + DEFER_MS), lastError: "Analytics intent deferred" },
        });
      } catch {}
      return "skipped";
    }
    if (lease) {
      try {
        await prisma.analyticsIntent.updateMany({
          where: { key, processedAt: null, nextAttemptAt: lease },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)]),
            lastError: "Analytics intent processing failed",
          },
        });
      } catch {}
    }
    return "failed";
  }
}

export async function retryAnalyticsIntents(dependencies: Dependencies = {}) {
  const rows = await prisma.analyticsIntent.findMany({
    where: { processedAt: null, nextAttemptAt: { lte: new Date() }, attempts: { lt: 10 } },
    orderBy: { createdAt: "asc" }, take: 100,
  });
  const results = await Promise.all(rows.map((row) => processAnalyticsIntent(row.key, dependencies)));
  await prisma.analyticsIntent.deleteMany({ where: { processedAt: { lt: new Date(Date.now() - 7 * 86400000) } } });
  return {
    processed: results.filter((result) => result === "processed").length,
    failed: results.filter((result) => result === "failed").length,
    skipped: results.filter((result) => result === "skipped").length,
  };
}

export function processAnalyticsIntentSoon(key: string): void {
  const promise = processAnalyticsIntent(key).catch(() => undefined);
  try {
    waitUntil(promise);
  } catch {
    void promise;
  }
}

export async function enqueueOutsideSaveAndProcessSoon(enqueue: () => Promise<string | null>): Promise<void> {
  try {
    const key = await enqueue();
    if (key) processAnalyticsIntentSoon(key);
  } catch (error) {
    console.error("Analytics intent could not be recorded", error);
  }
}
