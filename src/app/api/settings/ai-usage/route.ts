import { NextResponse } from "next/server";
import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import hasTeamOwnerOrProjectAdminAccess from "@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess";
import {
  aggregateGatewayByModel,
  aggregateGatewaySystemSpend,
  aggregateGatewayTeamUsage,
  buildDisplayModelUsage,
  gatewayBillingPeriodRange,
  type DirectByokModelUsage,
  type DisplayModelUsage,
} from "./gatewayUsage";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { teamAiAllowanceUsd } from "@/lib/aiAllowancePolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

type PercentageRow = { label: string; pct: number };

type AiUsageBreakdown = {
  agents: PercentageRow[];
  boards: PercentageRow[];
  directByokModels: DirectByokModelUsage[];
  features: PercentageRow[];
  tasks: PercentageRow[];
};

// Prisma groupBy row shapes (annotated so the callbacks below never fall back to
// implicit `any` while the local generated client lags the schema).
type FeatureGroupRow = {
  feature: string;
  _sum: { totalTokens: number | null };
};
type ProjectGroupRow = {
  projectId: number | null;
  _sum: { totalTokens: number | null };
};
type TaskGroupRow = {
  taskId: number | null;
  _sum: { totalTokens: number | null };
};
type AgentGroupRow = {
  agentId: string | null;
  _sum: { totalTokens: number | null };
};
type ModelGroupRow = {
  model: string;
  provider: string;
};

type AiUsageResponse = {
  configured: boolean;
  fundingSource: "customer" | "managed" | "shared" | null;
  period: { startDate: string; endDate: string } | null;
  allowance: {
    budgetUsd: number;
    pct: number;
    capped: boolean;
    remainingUsd: number;
    resetsOn: string; // ISO date, first of next month — the pool hard-resets here
    usedUsd: number;
    projectedPct: number | null; // end-of-month usage at the current daily pace
  } | null;
  includedWithHypertask: { usedUsd: number } | null;
  models: DisplayModelUsage[];
  features: PercentageRow[];
  boards: PercentageRow[];
  tasks: PercentageRow[];
  agents: PercentageRow[];
  usageMessage: string | null;
};

const gatewayGet = async (path: string, apiKey: string) => {
  return fetch(`${GATEWAY_BASE_URL}${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
};

const toPercentageRows = (
  rows: Array<{ label: string; value: number }>,
  limit?: number,
): PercentageRow[] => {
  const totalsByLabel = new Map<string, number>();
  for (const row of rows) {
    if (row.value <= 0) continue;
    totalsByLabel.set(
      row.label,
      (totalsByLabel.get(row.label) ?? 0) + row.value,
    );
  }
  const sorted = [...totalsByLabel]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const total = sorted.reduce((sum, row) => sum + row.value, 0);
  if (total <= 0) return [];

  const visible = limit ? sorted.slice(0, limit) : sorted;
  const remainder = limit
    ? sorted.slice(limit).reduce((sum, row) => sum + row.value, 0)
    : 0;

  return [
    ...visible,
    ...(remainder > 0 ? [{ label: "Others", value: remainder }] : []),
  ].map(({ label, value }) => ({
    label,
    pct: Math.round((value / total) * 100),
  }));
};

// First-party breakdown from the local AiUsage metering table (logAiUsage),
// alongside the AI Gateway aggregate above. Best-effort: AiUsage is written
// fire-and-forget from chat/editor/etc, so a query failure here must never
// take down the gateway usage response — just omit the breakdown.
const loadAiUsageBreakdown = async (
  teamId: string,
  startDate: string,
  endDate: string,
  scopeProjectIds?: number[],
): Promise<AiUsageBreakdown | null> => {
  try {
    const where = {
      teamId,
      ...(scopeProjectIds
        ? { projectId: { in: scopeProjectIds } }
        : {}),
      createdAt: {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      },
    };

    const [byFeature, byProject, byTask, byAgent, byModel] = await Promise.all([
      prisma.aiUsage.groupBy({
        by: ["feature"],
        where,
        _sum: { totalTokens: true },
      }),
      prisma.aiUsage.groupBy({
        by: ["projectId"],
        where,
        _sum: { totalTokens: true },
      }),
      prisma.aiUsage.groupBy({
        by: ["taskId"],
        where,
        _sum: { totalTokens: true },
      }),
      prisma.aiUsage.groupBy({
        by: ["agentId"],
        where,
        _sum: { totalTokens: true },
      }),
      prisma.aiUsage.groupBy({
        by: ["provider", "model"],
        where,
        _sum: { totalTokens: true },
      }),
    ]);

    const usageProjectIds = byProject.flatMap((row: ProjectGroupRow) =>
      row.projectId === null ? [] : [row.projectId],
    );
    const taskIds = byTask.flatMap((row: TaskGroupRow) =>
      row.taskId === null ? [] : [row.taskId],
    );
    const agentIds = byAgent.flatMap((row: AgentGroupRow) =>
      row.agentId === null ? [] : [row.agentId],
    );
    const [projects, tasks, agents] = await Promise.all([
      prisma.project.findMany({
        where: { id: { in: usageProjectIds } },
        select: { id: true, title: true, name: true },
      }),
      prisma.task.findMany({
        where: {
          id: { in: taskIds },
          project: {
            teamId,
            ...(scopeProjectIds
              ? { id: { in: scopeProjectIds } }
              : {}),
          },
        },
        select: { id: true, ticketNumber: true, title: true },
      }),
      prisma.agent.findMany({
        where: {
          id: { in: agentIds },
          members: {
            some: {
              status: "Accepted",
              project: {
                teamId,
                ...(scopeProjectIds
                  ? { id: { in: scopeProjectIds } }
                  : {}),
              },
            },
          },
        },
        select: { id: true, displayName: true },
      }),
    ]);
    const projectLabels = new Map(
      projects.map((project) => [
        project.id,
        project.title ?? project.name ?? `Board ${project.id}`,
      ]),
    );
    const taskLabels = new Map(
      tasks.map((task) => [
        task.id,
        task.ticketNumber
          ? `${task.ticketNumber} · ${task.title}`
          : task.title || `Task ${task.id}`,
      ]),
    );
    const agentLabels = new Map(
      agents.map((agent) => [agent.id, agent.displayName]),
    );

    return {
      agents: toPercentageRows(
        byAgent.flatMap((row: AgentGroupRow) =>
          row.agentId === null
            ? []
            : [{
                label: agentLabels.get(row.agentId) ?? "Removed agent",
                value: row._sum.totalTokens ?? 0,
              }],
        ),
        6,
      ),
      directByokModels: byModel.flatMap((row: ModelGroupRow) =>
        row.provider.startsWith("byok:")
          ? [{ model: row.model, provider: row.provider }]
          : [],
      ),
      features: toPercentageRows(
        byFeature.map((row: FeatureGroupRow) => ({
          label: row.feature,
          value: row._sum.totalTokens ?? 0,
        })),
      ),
      boards: toPercentageRows(
        byProject.flatMap((row: ProjectGroupRow) =>
          row.projectId === null
            ? []
            : [
                {
                  label:
                    projectLabels.get(row.projectId) ??
                    `Board ${row.projectId}`,
                  value: row._sum.totalTokens ?? 0,
                },
              ],
        ),
        6,
      ),
      tasks: toPercentageRows(
        byTask.flatMap((row: TaskGroupRow) =>
          row.taskId === null
            ? []
            : [{
                label: taskLabels.get(row.taskId) ?? "Deleted task",
                value: row._sum.totalTokens ?? 0,
              }],
        ),
        6,
      ),
    };
  } catch (error) {
    console.error("Error loading AiUsage breakdown:", error);
    return null;
  }
};

export async function GET(request: Request) {
  const user = await getServerCookieUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const teamId = url.searchParams.get("teamId")?.trim();
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!teamId) {
    return NextResponse.json({ message: "teamId required" }, { status: 400 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      googleAccount: { select: { userId: true } },
      googleAccountId: true,
    },
  });

  if (!team) {
    return NextResponse.json({ message: "Team not found" }, { status: 404 });
  }

  const hasAccess = await hasTeamOwnerOrProjectAdminAccess(
    user.id,
    user.accountId,
    team,
    teamId,
    projectId ?? null,
  );
  if (!hasAccess) {
    return NextResponse.json(
      { message: "Only the team owner or a board admin can view AI usage" },
      { status: 403 },
    );
  }
  const isTeamOwner =
    team.googleAccount.userId === user.id ||
    Boolean(user.accountId && user.accountId === team.googleAccountId);
  // Team owners may inspect the whole team's spend. A board admin is scoped
  // to the one board whose admin permission authorized this request.
  const breakdownProjectIds = isTeamOwner
    ? undefined
    : [Number(projectId)];

  // The funding source matters as much as the key: customer spend must never
  // be presented as consuming Hypertask's included allowance.
  const funding = await getTeamGatewayFunding({ trustedTeamId: teamId });

  if (!funding) {
    return NextResponse.json({
      configured: false,
      fundingSource: null,
      period: null,
      allowance: null,
      includedWithHypertask: null,
      models: [],
      features: [],
      boards: [],
      tasks: [],
      agents: [],
      usageMessage: "AI usage is not available for this team.",
    } satisfies AiUsageResponse);
  }

  const now = new Date();
  const { endDate, startDate } = gatewayBillingPeriodRange(now);
  const plan = await storePlanIdForProject(null, teamId);
  const allowanceUsd = teamAiAllowanceUsd(plan);
  const baseReportParams = {
    end_date: endDate,
    start_date: startDate,
    tags: `team:${teamId}`,
  };
  const dailyReportParams = new URLSearchParams({
    ...baseReportParams,
    group_by: "day",
  });
  const modelReportParams = new URLSearchParams({
    ...baseReportParams,
    group_by: "model",
  });
  const tagReportParams = new URLSearchParams({
    ...baseReportParams,
    group_by: "tag",
  });

  try {
    const breakdownPromise = loadAiUsageBreakdown(
      teamId,
      startDate,
      endDate,
      breakdownProjectIds,
    );
    const [dailyReportResponse, modelReportResponse, tagReportResponse] =
      await Promise.all([
        gatewayGet(`/report?${dailyReportParams.toString()}`, funding.apiKey),
        gatewayGet(`/report?${modelReportParams.toString()}`, funding.apiKey),
        gatewayGet(`/report?${tagReportParams.toString()}`, funding.apiKey),
      ]);
    if (
      !dailyReportResponse.ok ||
      !modelReportResponse.ok ||
      !tagReportResponse.ok
    ) {
      throw new Error(
        `AI Gateway report returned ${dailyReportResponse.status}/${modelReportResponse.status}/${tagReportResponse.status}`,
      );
    }

    const [dailyPayload, modelPayload, tagPayload, breakdown] =
      await Promise.all([
        dailyReportResponse.json(),
        modelReportResponse.json(),
        tagReportResponse.json(),
        breakdownPromise,
      ]);
    const totalPlatformUsd = Math.max(
      aggregateGatewayTeamUsage(dailyPayload).totalCost,
      0,
    );
    const systemUsedUsd = Math.min(
      aggregateGatewaySystemSpend(tagPayload),
      totalPlatformUsd,
    );
    const usedUsd = Math.max(totalPlatformUsd - systemUsedUsd, 0);
    const pct = Math.round((usedUsd / allowanceUsd) * 100);
    // The pool hard-resets on the 1st (no rollover), so the meaningful signals
    // are the reset date and the projected end-of-month usage at current pace —
    // not "days until the pool runs out", which would exceed the month.
    const daysElapsed = now.getUTCDate();
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const resetsOn = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    )
      .toISOString()
      .slice(0, 10);
    const projectedPct =
      usedUsd > 0
        ? Math.round(
            (((usedUsd / daysElapsed) * daysInMonth) / allowanceUsd) * 100,
          )
        : null;

    const models = buildDisplayModelUsage(
      aggregateGatewayByModel(modelPayload),
      breakdown?.directByokModels ?? [],
    );
    const customerFunded = funding.source === "customer";

    return NextResponse.json({
      configured: true,
      fundingSource: funding.source,
      period: { endDate, startDate },
      allowance: customerFunded
        ? null
        : {
            budgetUsd: allowanceUsd,
            pct,
            capped: pct >= 100,
            remainingUsd: Math.max(allowanceUsd - usedUsd, 0),
            resetsOn,
            projectedPct,
            usedUsd,
          },
      includedWithHypertask: customerFunded ? null : { usedUsd: systemUsedUsd },
      models: customerFunded
        ? models.map((row) => ({ ...row, onYourKey: true }))
        : models,
      features: breakdown?.features ?? [],
      boards: breakdown?.boards ?? [],
      tasks: breakdown?.tasks ?? [],
      agents: breakdown?.agents ?? [],
      usageMessage: customerFunded
        ? "Usage is billed to this team's own AI Gateway key and does not consume Hypertask's included allowance."
        : null,
    } satisfies AiUsageResponse);
  } catch (error) {
    console.error("Error loading per-team AI Gateway report:", error);
    return NextResponse.json(
      { message: "Could not load AI Gateway usage" },
      { status: 502 },
    );
  }
}
