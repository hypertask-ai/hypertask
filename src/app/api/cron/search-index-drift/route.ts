import { NextRequest, NextResponse } from "next/server";

import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { getRedis } from "@/lib/redis";
import { emptyDriftState, type DriftState } from "@/lib/search/indexDrift";
import { DRIFT_STATE_KEY, runIndexDriftRepair } from "@/lib/search/runIndexDriftRepair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function readState(raw: string | null): DriftState {
  if (!raw) return emptyDriftState();
  try {
    const parsed = JSON.parse(raw) as Partial<DriftState>;
    return {
      afterId: Number.isInteger(parsed.afterId) ? Number(parsed.afterId) : 0,
      found: Number.isInteger(parsed.found) ? Number(parsed.found) : 0,
      results: Array.isArray(parsed.results) ? parsed.results : [],
    };
  } catch {
    return emptyDriftState();
  }
}

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ message: "unauthorized" }, { status: 401 });
  }

  const redis = await getRedis();
  const state = readState(await redis.get(DRIFT_STATE_KEY));
  const result = await runIndexDriftRepair(state);
  await redis.set(DRIFT_STATE_KEY, JSON.stringify(result.state));
  console.log(
    `[search-index-drift] scanned ${result.scanned} reindexed ${result.reindexed} pass ${result.passComplete ? result.passFound : "open"}`,
  );
  return NextResponse.json({
    scanned: result.scanned,
    reindexed: result.reindexed,
    passComplete: result.passComplete,
    passFound: result.passFound,
    afterId: result.state.afterId,
    found: result.state.found,
    results: result.state.results,
  });
}
