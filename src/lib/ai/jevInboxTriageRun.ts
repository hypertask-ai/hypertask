import { generateText } from "ai";

import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { gatewayProviderOptionsForModel, resolveGatewayModel, type AiGatewayTags } from "@/app/api/ai/_lib/modelProvider";
import prisma from "@/lib/prisma";
import {
  JEV_TRIAGE_CALL_TIMEOUT_MS, JEV_TRIAGE_CONCURRENCY, JEV_TRIAGE_MAX_ITEMS, JEV_TRIAGE_MODEL_SLUG,
  buildJevTriagePrompt, jevTriageBatches, parseJevTriageBatch, selectJevNoiseIds, type JevTriageItem,
} from "@/lib/ai/jevInboxTriage";

export const JEV_TRIAGE_FALLBACK_MODEL_SLUG = "anthropic/claude-haiku-5.5";
export const JEV_TRIAGE_FALLBACK_TIMEOUT_MS = 2500;

export type JevTriageSkipped = "no_team" | "customer_funding" | "no_funding" | null;
export type JevTriageResult = { noiseIds: string[]; checked: number; skipped: JevTriageSkipped };

const ask = async (slug: string, timeout: number, prompt: string, apiKey: string, tags: AiGatewayTags) => {
  const model = resolveGatewayModel(slug, apiKey);
  const reply = generateText({
    model, prompt, maxOutputTokens: 300, temperature: 0, maxRetries: 0,
    abortSignal: AbortSignal.timeout(timeout),
    providerOptions: gatewayProviderOptionsForModel(model, "jev-inbox", tags),
  }).then((result) => result.text, () => null);
  const deadline = new Promise<null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);
    timer.unref?.();
  });
  return Promise.race([reply, deadline]);
};

const triage = async (batch: JevTriageItem[], apiKey: string, tags: AiGatewayTags) => {
  const prompt = buildJevTriagePrompt(batch);
  const jev = parseJevTriageBatch(await ask(JEV_TRIAGE_MODEL_SLUG, JEV_TRIAGE_CALL_TIMEOUT_MS, prompt, apiKey, tags), batch);
  if (jev.some((verdict) => verdict.confidence !== null)) return jev;
  return parseJevTriageBatch(await ask(JEV_TRIAGE_FALLBACK_MODEL_SLUG, JEV_TRIAGE_FALLBACK_TIMEOUT_MS, prompt, apiKey, tags), batch);
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
  const grouped = await teamsFor(args.items, args.userId);
  if (grouped.size === 0) return { noiseIds: [], checked: 0, skipped: "no_team" };
  const noiseIds = new Set<string>();
  let checked = 0;
  let skipped: JevTriageSkipped = "no_team";
  for (const [teamId, items] of grouped) {
    if (checked >= JEV_TRIAGE_MAX_ITEMS) break;
    const funding = await getTeamGatewayFunding({ trustedTeamId: teamId }).catch(() => undefined);
    if (!funding?.apiKey || funding.source === "customer") {
      skipped = funding?.apiKey ? "customer_funding" : "no_funding";
      continue;
    }
    const tags: AiGatewayTags = { teamId, userId: args.userId };
    const batch = items.slice(0, JEV_TRIAGE_MAX_ITEMS - checked);
    checked += batch.length;
    await eachBatch(jevTriageBatches(batch), async (batch) => {
      for (const id of selectJevNoiseIds(await triage(batch, funding.apiKey, tags))) noiseIds.add(id);
    });
  }
  return { noiseIds: Array.from(noiseIds), checked, skipped: checked > 0 ? null : skipped };
}
