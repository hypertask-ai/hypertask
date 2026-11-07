import "server-only";
import prisma from "@/lib/prisma";
import { isGuestUser } from "@/lib/demo/guest";
import { computeActivationForUser } from "@/lib/analytics/activationFacts";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";
import { legacyAccountCategory } from "./savedWorkAnalytics";

const ACTIVATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function captureActivationCompleted(userId: number, occurredAt = new Date()): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, uid: true, email: true, joinedAt: true },
  });
  if (!user || isGuestUser(user)) return;
  const elapsedMs = occurredAt.getTime() - user.joinedAt.getTime();
  if (elapsedMs >= ACTIVATION_WINDOW_MS) return;
  const activation = await computeActivationForUser(userId);
  if (!activation) return;
  const { boardId, teamId, signupAt, activatedAt, taskIds, version } = activation;
  await captureAnalyticsOccurrence(userId, "activation_completed", "analytics:activation_completed", {
    ...serverAnalyticsProperties(userId, teamId, boardId, `activation_completed:${userId}`, activatedAt),
    account_category: legacyAccountCategory(user),
    signup_at: signupAt.toISOString(),
    activated_at: activatedAt.toISOString(),
    hours_since_signup: Math.round((activatedAt.getTime() - signupAt.getTime()) / 360000) / 10,
    task_count: 3,
    is_seeded: false,
    definition_version: version,
    activation_task_ids: taskIds.map(String),
  }, { scope: "user", occurredAt: activatedAt });
}
