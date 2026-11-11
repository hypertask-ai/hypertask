import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9055_NEEDS_YOU_FLAG } from "@/lib/flags/definitions/htpr-9055-needs-you";
import { getTeamGatewayFunding, isOurGatewayKey, resolveTeamByokApiKey } from "@/app/api/ai/_lib/byokKeys";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { isOwnKeyOnlySettings } from "@/lib/ai/forcedTeamKey";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";
import { needsYouRules } from "@/lib/inbox/needsYou";
import { needsYouScore } from "@/lib/ai/needsYouScore";
import { canReadTaskNow } from "@/lib/access/canReadTaskNow";

export async function scoreNeedsYouInbox(userId: number) {
  if (!await isFeatureEnabled(HTPR_9055_NEEDS_YOU_FLAG, userId)) return 0;
  const rows = await prisma.notification.findMany({
    where: {
      userId, agentId: null, status: "Normal", archivedAt: null, taskId: { not: null },
      OR: [{ needsYouScoredAt: null }, { needsYouSource: "skipped", NOT: { needsYouReason: "Own AI" } }],
    },
    include: {
      task: { select: { title: true, waitingOnUserId: true, priority: true } },
      comment: { select: { text: true, kind: true } },
      project: { select: { teamId: true, team: { select: { aiProviderSettings: true, byokApiKeys: { where: { enabled: true }, select: { provider: true } } } } } },
    },
    orderBy: { id: "asc" }, take: 100,
  });
  const rankModes = new Map<string, Promise<"skip" | "rules" | "jev">>();
  const rankMode = (teamId: string, team: NonNullable<NonNullable<typeof rows[number]["project"]>["team"]>) => {
    let pending = rankModes.get(teamId);
    if (!pending) {
      const extraKey = team.byokApiKeys.some(({ provider }) => !["gateway", "openai", "claude", "managed_gateway"].includes(provider));
      pending = isOwnKeyOnlySettings(team.aiProviderSettings)
        ? Promise.resolve("skip")
        : Promise.all([
          storePlanIdForProject(null, teamId), getTeamGatewayFunding({ trustedTeamId: teamId }),
          resolveTeamByokApiKey("openai", { trustedTeamId: teamId }), resolveTeamByokApiKey("claude", { trustedTeamId: teamId }),
        ]).then(([plan, funding, openai, claude]) => {
          if (plan === "BYOK" || funding?.source === "customer" || [openai, claude].some((key) => key && !isOurGatewayKey(key))) return "skip" as const;
          if (extraKey || !resolveTeamProviderEnabled(team.aiProviderSettings, "openrouter")) return "rules" as const;
          return "jev" as const;
        }).catch(() => "skip" as const);
      rankModes.set(teamId, pending);
    }
    return pending;
  };
  let next = 0;
  let scored = 0;
  await Promise.all(Array.from({ length: Math.min(8, rows.length) }, async () => {
    while (next < rows.length) {
      const notice = rows[next++];
      const teamId = notice.project?.teamId;
      const team = notice.project?.team;
      const mode = notice.taskId !== null && teamId && team && await canReadTaskNow(userId, notice.taskId) ? await rankMode(teamId, team) : "skip";
      const rules = needsYouRules(notice);
      const claim = await prisma.notification.updateMany({
        where: { id: notice.id, OR: [{ needsYouScoredAt: null }, { needsYouSource: "skipped", NOT: { needsYouReason: "Own AI" } }] },
        data: mode === "skip"
          ? { needsYouScoredAt: new Date(), needsYouScore: 0, needsYouReason: "Own AI", needsYouSource: "skipped", needsYouCostUsd: 0 }
          : { needsYouScoredAt: new Date(), needsYouScore: rules.score, needsYouReason: rules.reason, needsYouSource: "rules", needsYouCostUsd: 0 },
      });
      if (!claim.count) continue;
      if (mode === "jev") await prisma.notification.update({ where: { id: notice.id }, data: await needsYouScore(notice) });
      scored++;
    }
  }));
  return scored;
}
