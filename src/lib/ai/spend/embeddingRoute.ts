import { getTeamGatewayFunding, isOurGatewayKey, resolveTeamByokApiKey } from "@/app/api/ai/_lib/byokKeys";
import { remainingSpendPathEnabled, resolveTeamAllowancePolicy } from "@/app/api/ai/_lib/planAllowancePolicy";
import { reservePlanAllowance, settlePlanAllowance, teamAllowanceSnapshot } from "@/app/api/ai/_lib/sharedAllowance";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import prisma from "@/lib/prisma";
import { embeddingCostUsd, embeddingDecision, upperBoundTokens, type EmbeddingDecision } from "@/lib/ai/spend/remainingSpend";

export type EmbeddingRoute = {
  mode: EmbeddingDecision;
  httpKey?: string;
  allowanceKey?: string;
  fundingSource?: "shared" | "managed";
};

export async function embeddingRouteForTeam(teamId: string): Promise<EmbeddingRoute> {
  const spendPathOn = await remainingSpendPathEnabled(teamId).catch(() => false);
  if (!spendPathOn) return { mode: "current" };

  const plan = await storePlanIdForProject(null, teamId).catch(() => null);
  const openai = await resolveTeamByokApiKey("openai", { trustedTeamId: teamId }).catch(() => undefined);
  const gateway = await resolveTeamByokApiKey("gateway", { trustedTeamId: teamId }).catch(() => undefined);
  const ownKey = [openai, gateway].find((key) => typeof key === "string" && key.trim() && !isOurGatewayKey(key));
  const funding = await getTeamGatewayFunding({ trustedTeamId: teamId }).catch(() => undefined);
  const canCharge = Boolean(funding && funding.source !== "customer");
  let overCap = !canCharge;
  if (canCharge && funding) {
    const policy = await resolveTeamAllowancePolicy(teamId, funding.source);
    if (policy.mode !== "plan") {
      overCap = true;
    } else {
      const snapshot = await teamAllowanceSnapshot(teamId, policy.monthlyUsd, policy, {
        userId: 0,
        gatewayApiKey: funding.apiKey,
        fundingSource: funding.source,
      }).catch(() => null);
      overCap = !snapshot || snapshot.usedUsd >= snapshot.allowanceUsd;
    }
  }

  const mode = embeddingDecision({
    spendPathOn: true,
    plan,
    hasOwnKey: Boolean(ownKey),
    overCap,
    canCharge,
  });
  if (mode === "customer-key" && ownKey) return { mode, httpKey: ownKey };
  if (mode === "vector" && funding && funding.source !== "customer") {
    return {
      mode,
      allowanceKey: funding.apiKey,
      fundingSource: funding.source,
    };
  }
  if (mode === "vector") return { mode: "keyword" };
  return { mode };
}

export type SearchEmbeddingRoute =
  | { kind: "current" }
  | { kind: "keyword" }
  | { kind: "vector"; teamId: string; allowanceKey: string; fundingSource: "shared" | "managed" }
  | { kind: "customer-key"; httpKey: string };

export async function searchRouteForProjects(projectIds: number[]): Promise<SearchEmbeddingRoute> {
  const ids = [...new Set(projectIds.filter((id) => Number.isInteger(id)))];
  if (ids.length === 0) return { kind: "current" };
  const projects = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { teamId: true },
  });
  const teamIds = [...new Set(projects.map((project) => project.teamId).filter((id): id is string => Boolean(id)))];
  if (teamIds.length !== 1) {
    if (teamIds.length === 0) return { kind: "current" };
    const routes = await Promise.all(teamIds.map((id) => embeddingRouteForTeam(id)));
    return routes.some((route) => route.mode !== "current") ? { kind: "keyword" } : { kind: "current" };
  }
  const route = await embeddingRouteForTeam(teamIds[0]);
  if (route.mode === "current") return { kind: "current" };
  if (route.mode === "customer-key" && route.httpKey) return { kind: "customer-key", httpKey: route.httpKey };
  if (route.mode === "vector" && route.allowanceKey && route.fundingSource) {
    return {
      kind: "vector",
      teamId: teamIds[0],
      allowanceKey: route.allowanceKey,
      fundingSource: route.fundingSource,
    };
  }
  return { kind: "keyword" };
}

export async function withEmbeddingCharge<T>(
  args: { teamId: string; texts: string[]; allowanceKey: string; fundingSource: "shared" | "managed" },
  work: () => Promise<T>,
): Promise<T> {
  const policy = await resolveTeamAllowancePolicy(args.teamId, args.fundingSource);
  if (policy.mode !== "plan") return work();
  const usd = args.texts.reduce((sum, text) => sum + embeddingCostUsd(upperBoundTokens(text)), 0);
  const micro = Math.max(1, Math.ceil(usd * 1_000_000));
  const reservation = await reservePlanAllowance({
    teamId: args.teamId,
    policy,
    gatewayApiKey: args.allowanceKey,
    fundingSource: args.fundingSource,
    amountUsd: micro / 1_000_000,
    amountMicroUsd: micro,
    lane: "visible",
    userId: 0,
  });
  try {
    const result = await work();
    await settlePlanAllowance(reservation, micro / 1_000_000, "finish");
    return result;
  } catch (error) {
    await settlePlanAllowance(reservation, 0, "error").catch(() => undefined);
    throw error;
  }
}
