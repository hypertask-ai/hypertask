import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9055_NEEDS_YOU_FLAG } from "@/lib/flags/definitions/htpr-9055-needs-you";
import { getTeamGatewayFunding, isOurGatewayKey, resolveTeamByokApiKey } from "@/app/api/ai/_lib/byokKeys";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { isOwnKeyOnlySettings } from "@/lib/ai/forcedTeamKey";
import { needsYouRules } from "@/lib/inbox/needsYou";
import { needsYouScore } from "@/lib/ai/needsYouScore";
import { canReadTaskNow } from "@/lib/access/canReadTaskNow";

export async function scoreNeedsYouInbox(userId: number) {
  if (!await isFeatureEnabled(HTPR_9055_NEEDS_YOU_FLAG, userId)) return 0;
  const rows = await prisma.notification.findMany({
    where: { userId, agentId: null, status: "Normal", archivedAt: null, needsYouScoredAt: null, taskId: { not: null } },
    include: {
      task: { select: { title: true, waitingOnUserId: true, priority: true } },
      comment: { select: { text: true, kind: true } },
      project: { select: { teamId: true, team: { select: { aiProviderSettings: true, byokApiKeys: { where: { enabled: true }, select: { provider: true } } } } } },
    },
    orderBy: { id: "asc" }, take: 100,
  });
  const eligibleTeams = new Map<string, Promise<boolean>>();
  const eligible = (teamId: string, team: NonNullable<NonNullable<typeof rows[number]["project"]>["team"]>) => {
    let pending = eligibleTeams.get(teamId);
    if (!pending) {
      pending = (async () => {
        if (isOwnKeyOnlySettings(team.aiProviderSettings) || team.byokApiKeys.some(({ provider }) => !["gateway", "openai", "claude", "managed_gateway"].includes(provider))) return false;
        const [plan, funding, openai, claude] = await Promise.all([
          storePlanIdForProject(null, teamId), getTeamGatewayFunding({ trustedTeamId: teamId }),
          resolveTeamByokApiKey("openai", { trustedTeamId: teamId }), resolveTeamByokApiKey("claude", { trustedTeamId: teamId }),
        ]);
        return plan !== "BYOK" && funding?.source !== "customer" && ![openai, claude].some((key) => key && !isOurGatewayKey(key));
      })().catch(() => false);
      eligibleTeams.set(teamId, pending);
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
      const allowed = notice.taskId !== null && await canReadTaskNow(userId, notice.taskId)
        && Boolean(teamId && team && await eligible(teamId, team));
      const rules = needsYouRules(notice);
      const claim = await prisma.notification.updateMany({
        where: { id: notice.id, needsYouScoredAt: null },
        data: { needsYouScoredAt: new Date(), needsYouScore: rules.score, needsYouReason: rules.reason, needsYouSource: allowed ? "rules" : "skipped", needsYouCostUsd: 0 },
      });
      if (!claim.count) continue;
      if (allowed) await prisma.notification.update({ where: { id: notice.id }, data: await needsYouScore(notice) });
      scored++;
    }
  }));
  return scored;
}
