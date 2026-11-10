import { getTeamGatewayFunding, isOurGatewayKey, resolveTeamByokApiKey } from "@/app/api/ai/_lib/byokKeys";
import { remainingSpendPathEnabled, resolveTeamAllowancePolicy } from "@/app/api/ai/_lib/planAllowancePolicy";
import { reservePlanAllowance, settlePlanAllowance, teamAllowanceSnapshot, SharedAiAllowanceExceededError } from "@/app/api/ai/_lib/sharedAllowance";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import prisma from "@/lib/prisma";
import { embeddingCostUsd, embeddingDecision, upperBoundTokens, type EmbeddingDecision } from "@/lib/ai/spend/remainingSpend";

type Route = { mode: EmbeddingDecision; httpKey?: string; allowanceKey?: string; fundingSource?: "shared" | "managed" };
async function routeForTeam(teamId: string): Promise<Route> {
  if (!await remainingSpendPathEnabled(teamId).catch(() => false)) return { mode: "current" };
  const [plan, openai, gateway, funding] = await Promise.all([
    storePlanIdForProject(null, teamId).catch(() => null),
    resolveTeamByokApiKey("openai", { trustedTeamId: teamId }).catch(() => undefined),
    resolveTeamByokApiKey("gateway", { trustedTeamId: teamId }).catch(() => undefined),
    getTeamGatewayFunding({ trustedTeamId: teamId }).catch(() => undefined),
  ]);
  const ownKey = [openai, gateway].find((key) => typeof key === "string" && key.trim() && !isOurGatewayKey(key));
  const source = funding && funding.source !== "customer" ? funding.source : undefined;
  let overCap = !source;
  if (source && funding) {
    const policy = await resolveTeamAllowancePolicy(teamId, source);
    const snapshot = policy.mode === "plan" ? await teamAllowanceSnapshot(teamId, policy.monthlyUsd, policy, { userId: 0, gatewayApiKey: funding.apiKey, fundingSource: source }).catch(() => null) : null;
    overCap = policy.mode !== "plan" || !snapshot || snapshot.usedUsd >= snapshot.allowanceUsd;
  }
  const mode = embeddingDecision({ spendPathOn: true, plan, hasOwnKey: Boolean(ownKey), overCap, canCharge: Boolean(source) });
  if (mode === "customer-key" && ownKey) return { mode, httpKey: ownKey };
  if (mode === "vector" && source && funding) return { mode, allowanceKey: funding.apiKey, fundingSource: source };
  return { mode: mode === "vector" ? "keyword" : mode };
}
async function charge<T>(teamId: string, texts: string[], key: string, source: "shared" | "managed", work: () => Promise<T>) {
  const policy = await resolveTeamAllowancePolicy(teamId, source);
  if (policy.mode !== "plan") return work();
  const micro = Math.max(1, Math.ceil(texts.reduce((sum, text) => sum + embeddingCostUsd(upperBoundTokens(text)), 0) * 1_000_000));
  const reservation = await reservePlanAllowance({ teamId, policy, gatewayApiKey: key, fundingSource: source, amountUsd: micro / 1_000_000, amountMicroUsd: micro, lane: "visible", userId: 0 });
  try { const result = await work(); await settlePlanAllowance(reservation, micro / 1_000_000, "finish"); return result; }
  catch (error) { await settlePlanAllowance(reservation, 0, "error").catch(() => undefined); throw error; }
}
async function teamIds(projectIds: number[]) {
  const ids = [...new Set(projectIds.filter((id) => Number.isInteger(id)))];
  if (ids.length === 0) return [];
  const projects = await prisma.project.findMany({ where: { id: { in: ids } }, select: { teamId: true } });
  return [...new Set(projects.map((project) => project.teamId).filter((id): id is string => Boolean(id)))];
}
export async function embeddingSpendMode(projectIds: number[], teamId?: string | null): Promise<(Route & { teamId?: string }) | "mixed-keyword"> {
  const ids = teamId ? [teamId] : await teamIds(projectIds);
  if (ids.length !== 1) {
    if (ids.length === 0) return { mode: "current" };
    const routes = await Promise.all(ids.map((id) => routeForTeam(id)));
    return routes.some((route) => route.mode !== "current") ? "mixed-keyword" : { mode: "current" };
  }
  return { ...(await routeForTeam(ids[0])), teamId: ids[0] };
}
export async function withSpendCharge<T>(route: Route, teamId: string, texts: string[], work: () => Promise<T>) {
  if (route.mode === "vector" && route.allowanceKey && route.fundingSource) {
    try { return await charge(teamId, texts, route.allowanceKey, route.fundingSource, work); }
    catch (error) { if (error instanceof SharedAiAllowanceExceededError) return null; throw error; }
  }
  return work();
}
