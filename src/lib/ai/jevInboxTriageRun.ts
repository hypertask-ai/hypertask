import { getTeamGatewayFunding, isOurGatewayKey, resolveTeamByokApiKey } from "@/app/api/ai/_lib/byokKeys";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { isOwnKeyOnlySettings } from "@/lib/ai/forcedTeamKey";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";
import prisma from "@/lib/prisma";
import {
  JEV_TRIAGE_CALL_TIMEOUT_MS, JEV_TRIAGE_CONCURRENCY, JEV_TRIAGE_MAX_ITEMS,
  buildJevTriageRequest, jevTriageBatches, parseJevTriageBatch, selectJevNoiseIds, type JevTriageItem,
} from "@/lib/ai/jevInboxTriage";

export type JevTriageSkipped = "no_team" | "customer_funding" | "no_funding" | null;
export type JevTriageResult = { noiseIds: string[]; checked: number; skipped: JevTriageSkipped };

const triage = async (batch: JevTriageItem[], apiKey: string) => {
  try {
    const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildJevTriageRequest(batch)),
      signal: AbortSignal.timeout(JEV_TRIAGE_CALL_TIMEOUT_MS),
    });
    return parseJevTriageBatch(response.ok ? await response.json() : null, batch);
  } catch {
    return parseJevTriageBatch(null, batch);
  }
};

const eachBatch = async <T,>(batches: T[], work: (batch: T) => Promise<void>) => {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(JEV_TRIAGE_CONCURRENCY, batches.length) }, async () => {
    while (next < batches.length) {
      const batch = batches[next];
      next += 1;
      await work(batch);
    }
  }));
};

const teamsFor = async (items: JevTriageItem[], userId: number) => {
  const projectIds = Array.from(new Set(items.flatMap((item) => (item.projectId === null ? [] : [item.projectId]))));
  const projects = projectIds.length
    ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, teamId: true } })
    : [];
  const teamByProject = new Map(projects.map((project) => [project.id, project.teamId]));
  const fallback = items.some((item) => item.projectId === null)
    ? (await prisma.team.findFirst({ where: { googleAccount: { userId } }, select: { id: true } }))?.id
    : undefined;
  const grouped = new Map<string, JevTriageItem[]>();
  for (const item of items) {
    const teamId = item.projectId === null ? fallback : teamByProject.get(item.projectId);
    if (teamId) grouped.set(teamId, [...(grouped.get(teamId) ?? []), item]);
  }
  return grouped;
};

export async function jevInboxTriage(args: { items: JevTriageItem[]; userId: number }): Promise<JevTriageResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return { noiseIds: [], checked: 0, skipped: "no_funding" };
  const grouped = await teamsFor(args.items, args.userId);
  if (grouped.size === 0) return { noiseIds: [], checked: 0, skipped: "no_team" };
  const noiseIds = new Set<string>();
  let checked = 0;
  let submitted = 0;
  let skipped: JevTriageSkipped = "no_team";
  for (const [teamId, items] of grouped) {
    if (submitted >= JEV_TRIAGE_MAX_ITEMS) break;
    const funding = await getTeamGatewayFunding({ trustedTeamId: teamId }).catch(() => undefined);
    if (!funding?.apiKey || funding.source === "customer") {
      skipped = funding?.apiKey ? "customer_funding" : "no_funding";
      continue;
    }
    const eligibility = await Promise.all([
      storePlanIdForProject(null, teamId),
      prisma.team.findUnique({ where: { id: teamId }, select: { aiProviderSettings: true, byokApiKeys: { where: { enabled: true }, select: { provider: true } } } }),
      resolveTeamByokApiKey("openai", { trustedTeamId: teamId }),
      resolveTeamByokApiKey("claude", { trustedTeamId: teamId }),
    ]).catch(() => null);
    if (!eligibility || !eligibility[1]) { skipped = "no_funding"; continue; }
    const [plan, team, openai, claude] = eligibility;
    if (plan === "BYOK" || isOwnKeyOnlySettings(team.aiProviderSettings) || !resolveTeamProviderEnabled(team.aiProviderSettings, "openrouter") ||
      team.byokApiKeys.some(({ provider }) => !["gateway", "openai", "claude", "managed_gateway"].includes(provider)) ||
      [openai, claude].some((key) => key && !isOurGatewayKey(key))) { skipped = "customer_funding"; continue; }
    skipped = null;
    const batch = items.slice(0, JEV_TRIAGE_MAX_ITEMS - submitted);
    submitted += batch.length;
    await eachBatch(jevTriageBatches(batch), async (batch) => {
      const verdicts = await triage(batch, apiKey);
      checked += verdicts.filter((verdict) => verdict.confidence !== null).length;
      for (const id of selectJevNoiseIds(verdicts)) noiseIds.add(id);
    });
  }
  return { noiseIds: Array.from(noiseIds), checked, skipped };
}
