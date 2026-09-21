import { PAID_TEAM_AI_ALLOWANCE_USD } from "@/lib/aiAllowancePolicy";
import {
  INCLUDED_WITH_HYPERTASK_GATEWAY_TAG,
  SYSTEM_AI_FEATURES,
} from "@/lib/aiUsageClassification";

export type GatewayTeamUsage = {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  requestCount: number;
  totalCost: number;
};

export type GatewayModelUsage = {
  model: string;
  totalCost: number;
};

export type GatewayUserTagUsage = {
  totalCost: number;
  userId: number;
};

export type GatewayMemberUsage = {
  displayName: string;
  sharePct: number;
  userId: number | null;
};

export type PersonalTeamUsage = {
  memberCount: number;
  memberUsage?: GatewayMemberUsage[];
  userSharePct: number;
};

// Backward-compatible default for callers that have not supplied the plan yet.
export const TEAM_AI_BUDGET_USD = PAID_TEAM_AI_ALLOWANCE_USD;

export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const GATEWAY_REQUEST_TIMEOUT_MS = 10_000;

export type DisplayModelUsage = {
  label: string;
  onYourKey: boolean;
  pct: number | null;
};

export type DirectByokModelUsage = {
  model: string;
  provider: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const finiteNumber = (value: unknown, field: string) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new Error(`Invalid AI Gateway ${field}`);
  }
  return parsed;
};

const nonNegativeNumber = (value: unknown, field: string) => {
  const parsed = finiteNumber(value, field);
  if (parsed < 0) throw new Error(`Invalid AI Gateway ${field}`);
  return parsed;
};

const addGatewayNumber = (total: number, value: unknown, field: string) => {
  const sum = total + nonNegativeNumber(value, field);
  if (!Number.isFinite(sum)) throw new Error(`Invalid AI Gateway ${field}`);
  return sum;
};

const addGatewayCount = (total: number, value: unknown, field: string) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid AI Gateway ${field}`);
  }
  const sum = total + parsed;
  if (!Number.isSafeInteger(sum)) throw new Error(`Invalid AI Gateway ${field}`);
  return sum;
};

export const aggregateGatewayTeamUsage = (
  payload: unknown,
): GatewayTeamUsage => {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.results)) {
    throw new Error("Invalid AI Gateway report response");
  }

  return record.results.reduce<GatewayTeamUsage>(
    (total, value) => {
      const row = asRecord(value);
      if (!row) throw new Error("Invalid AI Gateway report row");

      return {
        cachedInputTokens:
          addGatewayCount(
            total.cachedInputTokens,
            row.cached_input_tokens ?? 0,
            "cached_input_tokens",
          ),
        inputTokens:
          addGatewayCount(total.inputTokens, row.input_tokens ?? 0, "input_tokens"),
        outputTokens:
          addGatewayCount(
            total.outputTokens,
            row.output_tokens ?? 0,
            "output_tokens",
          ),
        reasoningTokens:
          addGatewayCount(
            total.reasoningTokens,
            row.reasoning_tokens ?? 0,
            "reasoning_tokens",
          ),
        requestCount:
          addGatewayCount(
            total.requestCount,
            row.request_count ?? 0,
            "request_count",
          ),
        totalCost:
          addGatewayNumber(total.totalCost, row.total_cost ?? 0, "total_cost"),
      };
    },
    {
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      requestCount: 0,
      totalCost: 0,
    },
  );
};

export const aggregateGatewayByModel = (
  payload: unknown,
): GatewayModelUsage[] => {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.results)) {
    throw new Error("Invalid AI Gateway report response");
  }

  const totals = new Map<string, number>();

  for (const value of record.results) {
    const row = asRecord(value);
    if (!row || typeof row.model !== "string" || !row.model.trim()) {
      throw new Error("Invalid AI Gateway model report row");
    }

    const model = row.model.trim();
    const totalCost = finiteNumber(row.total_cost ?? 0, "total_cost");
    totals.set(model, (totals.get(model) ?? 0) + totalCost);
  }

  return Array.from(totals, ([model, totalCost]) => ({
    model,
    totalCost,
  })).sort(
    (a, b) => b.totalCost - a.totalCost || a.model.localeCompare(b.model),
  );
};

export const aggregateGatewayByUserTag = (
  payload: unknown,
): GatewayUserTagUsage[] => {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.results)) {
    throw new Error("Invalid AI Gateway report response");
  }

  const totals = new Map<number, number>();

  for (const value of record.results) {
    const row = asRecord(value);
    if (!row || typeof row.tag !== "string") {
      throw new Error("Invalid AI Gateway tag report row");
    }

    const match = /^user:(\d+)$/.exec(row.tag.trim());
    if (!match) continue;

    const userId = Number(match[1]);
    const totalCost = finiteNumber(row.total_cost ?? 0, "total_cost");
    totals.set(userId, (totals.get(userId) ?? 0) + totalCost);
  }

  return Array.from(totals, ([userId, totalCost]) => ({
    totalCost,
    userId,
  })).sort((a, b) => b.totalCost - a.totalCost || a.userId - b.userId);
};

const aggregateGatewaySystemSpendParts = (payload: unknown) => {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.results)) {
    throw new Error("Invalid AI Gateway report response");
  }

  let markedSystemSpend = 0;
  let legacySystemSpend = 0;
  for (const value of record.results) {
    const row = asRecord(value);
    if (!row || typeof row.tag !== "string") {
      throw new Error("Invalid AI Gateway tag report row");
    }
    const totalCost = finiteNumber(row.total_cost ?? 0, "total_cost");
    const tag = row.tag.trim();
    if (tag === INCLUDED_WITH_HYPERTASK_GATEWAY_TAG) {
      markedSystemSpend += totalCost;
    }
    if ((SYSTEM_AI_FEATURES as readonly string[]).includes(tag)) {
      legacySystemSpend += totalCost;
    }
  }

  return {
    legacyUserTaggedSpend: Math.max(
      legacySystemSpend - markedSystemSpend,
      0,
    ),
    systemSpend: Math.max(markedSystemSpend, legacySystemSpend, 0),
  };
};

export const aggregateGatewaySystemSpend = (payload: unknown): number =>
  aggregateGatewaySystemSpendParts(payload).systemSpend;

export const reconcileLegacySystemUserSpend = (
  rows: GatewayUserTagUsage[],
  legacySystemSpend: number,
): GatewayUserTagUsage[] => {
  const taggedSpend = rows.reduce(
    (total, row) => total + Math.max(row.totalCost, 0),
    0,
  );
  if (taggedSpend <= 0 || legacySystemSpend <= 0) return rows;

  // Gateway reports cannot group by both feature and custom user tag. Before
  // the stable system tag shipped, automatic requests carried member tags, so
  // remove that known legacy total proportionally. This temporary month-bound
  // reconciliation keeps member totals consistent without guessing that all
  // system spend belonged to one person.
  const retainedShare =
    Math.max(taggedSpend - legacySystemSpend, 0) / taggedSpend;
  return rows.map((row) => ({
    ...row,
    totalCost: Math.max(row.totalCost, 0) * retainedShare,
  }));
};

export const buildGatewayMemberUsage = (
  members: Array<{ displayName: string; userId: number }>,
  userTagUsage: GatewayUserTagUsage[],
  teamSpendUsd: number,
  shareUsd: number,
): GatewayMemberUsage[] => {
  const spendByUserId = new Map(
    userTagUsage.map((row) => [row.userId, Math.max(row.totalCost, 0)]),
  );
  const knownMemberSpend = members.reduce(
    (total, member) => total + (spendByUserId.get(member.userId) ?? 0),
    0,
  );
  const usage: Array<{
    displayName: string;
    spendUsd: number;
    userId: number | null;
  }> = members.map((member) => ({
    displayName: member.displayName,
    spendUsd: spendByUserId.get(member.userId) ?? 0,
    userId: member.userId,
  }));
  const unattributedSpendUsd = Math.max(teamSpendUsd - knownMemberSpend, 0);
  if (unattributedSpendUsd > 0) {
    usage.push({
      displayName: "Other / agents",
      spendUsd: unattributedSpendUsd,
      userId: null,
    });
  }

  return usage
    .sort(
      (a, b) =>
        b.spendUsd - a.spendUsd || a.displayName.localeCompare(b.displayName),
    )
    .map(({ displayName, spendUsd, userId }) => ({
      displayName,
      // ceil, not round: any real spend must show as at least 1%, never a flat 0%
      sharePct:
        shareUsd > 0 ? Math.ceil((Math.max(spendUsd, 0) / shareUsd) * 100) : 0,
      userId,
    }));
};

export const gatewayBillingPeriodRange = (now = new Date()) => ({
  endDate: now.toISOString().slice(0, 10),
  startDate: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-01`,
});

const PERSONAL_USAGE_REPORT_MAX_BYTES = 8 * 1024 * 1024;

type GatewayGetOptions = {
  maxBytes: number;
};

const readBoundedGatewayBody = async (
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
) => {
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancelOnAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancelOnAbort, { once: true });
  if (signal.aborted) {
    await reader.cancel().catch(() => undefined);
    throw new Error("AI Gateway request aborted");
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const nextTotalBytes = totalBytes + value.byteLength;
      if (nextTotalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("AI Gateway response is too large");
      }
      chunks.push(value);
      totalBytes = nextTotalBytes;
    }
  } finally {
    signal.removeEventListener("abort", cancelOnAbort);
  }

  if (signal.aborted) {
    throw new Error("AI Gateway request aborted");
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export const gatewayGet = async (
  path: string,
  apiKey: string,
  options: GatewayGetOptions = { maxBytes: PERSONAL_USAGE_REPORT_MAX_BYTES },
) => {
  const { maxBytes } = options;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > PERSONAL_USAGE_REPORT_MAX_BYTES
  ) {
    throw new Error("Invalid AI Gateway response size limit");
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GATEWAY_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${GATEWAY_BASE_URL}${path}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    // Buffer the body while the abort signal is active. Callers still receive
    // a Response, but a gateway that stalls after sending headers cannot leave
    // response.json() hanging past the request timeout.
    const body = await readBoundedGatewayBody(
      response,
      maxBytes,
      controller.signal,
    );
    const headers = new Headers(response.headers);
    // fetch transparently decodes compressed bodies. Do not advertise the
    // original encoding or length after rebuilding the buffered response.
    headers.delete("content-encoding");
    headers.delete("content-length");
    // The callers use the standard status, headers, and body methods. The
    // buffered response intentionally omits runtime-specific metadata such as
    // the original URL because it is not part of this helper's contract.
    return new Response(
      response.status === 204 || response.status === 205 ? null : body,
      {
        headers,
        status: response.status,
        statusText: response.statusText,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const computePersonalTeamSharePct = async ({
  allowanceUsd = TEAM_AI_BUDGET_USD,
  gatewayKey,
  memberIds,
  members,
  teamId,
  userId,
}: {
  allowanceUsd?: number;
  gatewayKey: string | null;
  memberIds: number[];
  members?: Array<{ displayName: string; userId: number }>;
  teamId: string;
  userId: number;
}): Promise<PersonalTeamUsage> => {
  const memberCount = Math.max(new Set(memberIds).size, 1);
  const shareUsd = allowanceUsd / memberCount;

  const responseForSpend = (
    userTagUsage: GatewayUserTagUsage[],
    teamSpendUsd: number,
  ): PersonalTeamUsage => {
    const spendByUserId = new Map(
      userTagUsage.map((row) => [row.userId, Math.max(row.totalCost, 0)]),
    );
    const userSpendUsd = spendByUserId.get(userId) ?? 0;

    return {
      memberCount,
      ...(members
        ? {
            memberUsage: buildGatewayMemberUsage(
              members,
              userTagUsage,
              teamSpendUsd,
              shareUsd,
            ),
          }
        : {}),
      userSharePct:
        shareUsd > 0
          ? Math.ceil((Math.max(userSpendUsd, 0) / shareUsd) * 100)
          : 0,
    };
  };

  if (!gatewayKey) return responseForSpend([], 0);

  const { endDate, startDate } = gatewayBillingPeriodRange();
  const baseReportParams = {
    end_date: endDate,
    start_date: startDate,
    tags: `team:${teamId}`,
  };
  const tagReportParams = new URLSearchParams({
    ...baseReportParams,
    group_by: "tag",
  });

  try {
    // The day-grouped team report only feeds buildGatewayMemberUsage;
    // skip it when no member breakdown is requested (halves the fan-out
    // for the per-team "all" endpoint).
    if (!members) {
      const tagOnlyResponse = await gatewayGet(
        `/report?${tagReportParams.toString()}`,
        gatewayKey,
        { maxBytes: PERSONAL_USAGE_REPORT_MAX_BYTES },
      );
      if (!tagOnlyResponse.ok) {
        throw new Error(`AI Gateway report returned ${tagOnlyResponse.status}`);
      }
      const tagPayload = await tagOnlyResponse.json();
      const systemSpend = aggregateGatewaySystemSpendParts(tagPayload);
      return responseForSpend(
        reconcileLegacySystemUserSpend(
          aggregateGatewayByUserTag(tagPayload),
          systemSpend.legacyUserTaggedSpend,
        ),
        0,
      );
    }

    const teamReportParams = new URLSearchParams({
      ...baseReportParams,
      group_by: "day",
    });
    const [teamReportResponse, tagReportResponse] = await Promise.all([
      gatewayGet(`/report?${teamReportParams.toString()}`, gatewayKey, {
        maxBytes: PERSONAL_USAGE_REPORT_MAX_BYTES,
      }),
      gatewayGet(`/report?${tagReportParams.toString()}`, gatewayKey, {
        maxBytes: PERSONAL_USAGE_REPORT_MAX_BYTES,
      }),
    ]);
    if (!teamReportResponse.ok || !tagReportResponse.ok) {
      throw new Error(
        `AI Gateway report returned ${teamReportResponse.status}/${tagReportResponse.status}`,
      );
    }

    const [teamPayload, tagPayload] = await Promise.all([
      teamReportResponse.json(),
      tagReportResponse.json(),
    ]);
    const systemSpend = aggregateGatewaySystemSpendParts(tagPayload);
    const teamSpendUsd = Math.max(
      aggregateGatewayTeamUsage(teamPayload).totalCost - systemSpend.systemSpend,
      0,
    );

    return responseForSpend(
      reconcileLegacySystemUserSpend(
        aggregateGatewayByUserTag(tagPayload),
        systemSpend.legacyUserTaggedSpend,
      ),
      teamSpendUsd,
    );
  } catch (error) {
    console.error(`Error loading personal AI usage for team ${teamId}:`, error);
    return responseForSpend([], 0);
  }
};

const displayModelLabel = (model: string) => {
  const providerSeparator = model.indexOf("/");
  return providerSeparator >= 0 ? model.slice(providerSeparator + 1) : model;
};

export function buildDisplayModelUsage(
  gatewayRows: GatewayModelUsage[],
  directByokModels: Array<string | DirectByokModelUsage>,
  limit = 6,
): DisplayModelUsage[] {
  const directLabels = new Set(
    directByokModels.map((row) =>
      typeof row === "string"
        ? displayModelLabel(row)
        : row.provider === "byok:custom"
          ? row.model
          : displayModelLabel(row.model),
    ),
  );
  const positiveGatewayRows = gatewayRows.filter((row) => row.totalCost > 0);
  const totalCost = positiveGatewayRows.reduce(
    (sum, row) => sum + row.totalCost,
    0,
  );
  const rows = new Map<string, DisplayModelUsage>();

  for (const row of positiveGatewayRows.slice(0, limit)) {
    const label = displayModelLabel(row.model);
    rows.set(label, {
      label,
      onYourKey: directLabels.has(label),
      pct: totalCost > 0 ? Math.round((row.totalCost / totalCost) * 100) : null,
    });
  }

  const remainderCost = positiveGatewayRows
    .slice(limit)
    .reduce((sum, row) => sum + row.totalCost, 0);
  if (remainderCost > 0) {
    rows.set("Others", {
      label: "Others",
      onYourKey: false,
      pct: Math.round((remainderCost / totalCost) * 100),
    });
  }

  for (const label of directLabels) {
    rows.set(label, {
      label,
      onYourKey: true,
      pct: rows.get(label)?.pct ?? null,
    });
  }

  return Array.from(rows.values());
}
