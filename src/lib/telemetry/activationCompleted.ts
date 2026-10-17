import "server-only";
import prisma from "@/lib/prisma";
import { isGuestUser } from "@/lib/demo/guest";
import { HTPR_7284_ACTIVATION_COMPLETED_FLAG, isFeatureEnabled } from "@/lib/flags";
import { HTPR_7293_ACTIVATION_METRIC_V1_FLAG } from "@/lib/flags/definitions/htpr-7293-activation-metric-v1";
import { computeActivationForUser } from "@/lib/analytics/activationFacts";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";
import { legacyAccountCategory } from "./savedWorkAnalytics";

const ACTIVATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function captureActivationCompleted(userId: number, occurredAt = new Date()): Promise<void> {
  if (!(await isFeatureEnabled(HTPR_7284_ACTIVATION_COMPLETED_FLAG, userId))) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, uid: true, email: true, joinedAt: true },
  });
  if (!user || isGuestUser(user)) return;
  const elapsedMs = occurredAt.getTime() - user.joinedAt.getTime();
  if (elapsedMs >= ACTIVATION_WINDOW_MS) return;
  if (await isFeatureEnabled(HTPR_7293_ACTIVATION_METRIC_V1_FLAG, userId)) {
    const activation = await computeActivationForUser(userId);
    if (!activation) return;
    const { boardId, teamId, signupAt, activatedAt, taskIds, version } = activation;
    await captureAnalyticsOccurrence(userId, "activation_completed", "analytics:activation_completed", {
      ...serverAnalyticsProperties(userId, teamId, boardId, `activation_completed:${userId}`, activatedAt),
      account_category: accountCategory(user),
      signup_at: signupAt.toISOString(),
      activated_at: activatedAt.toISOString(),
      hours_since_signup: Math.round((activatedAt.getTime() - signupAt.getTime()) / 360000) / 10,
      task_count: 3,
      is_seeded: false,
      definition_version: version,
      activation_task_ids: taskIds.map(String),
    }, { scope: "user", occurredAt: activatedAt });
    return;
  }
  const boards = await prisma.project.findMany({
    where: { ownerId: userId, seeded: false, status: "Normal" },
    select: {
      id: true,
      teamId: true,
      _count: { select: { tasks: { where: { status: "Normal", deletedAt: null, archivedAt: null, createdAt: { lte: occurredAt } } } } },
    },
    orderBy: { id: "asc" },
  });
  const board = boards.find((board) => board._count.tasks >= 3);
  if (!board) return;
  await captureAnalyticsOccurrence(userId, "activation_completed", "analytics:activation_completed", {
    ...serverAnalyticsProperties(userId, board.teamId, board.id, `activation_completed:${userId}`, occurredAt),
    account_category: legacyAccountCategory(user),
    signup_at: user.joinedAt.toISOString(),
    activated_at: occurredAt.toISOString(),
    hours_since_signup: Math.round(elapsedMs / 360000) / 10,
    task_count: board._count.tasks,
    is_seeded: false,
  }, { scope: "user" });
}
