import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  FEATURE_FLAG_OWNER_USER_ID,
  isFeatureFlagOwner,
} from "@/lib/flags";
import { TEAM_COMP_PLANS } from "@/lib/teamComp";
import {
  describeTeamComp,
  findTeamForComp,
  searchTeamsForComp,
  setTeamComp,
  TeamCompLookupError,
} from "@/lib/teamCompAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const targetSchema = z
  .object({
    teamId: z.string().uuid().optional(),
    email: z.string().trim().email().optional(),
  })
  .refine((t) => Boolean(t.teamId) !== Boolean(t.email), {
    message: "Pass exactly one of teamId or email",
  });

const setSchema = targetSchema.and(
  z.object({
    plan: z.enum(TEAM_COMP_PLANS),
    until: z.iso.datetime({ offset: true }).transform((value) => new Date(value))
      .refine((date) => date.getTime() > Date.now(), "until must be in the future"),
  }),
);

function noStore(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function trustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.slice(0, -1);
  if (!origin || !host || !protocol) return false;
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

async function ownerAccess(request: NextRequest) {
  if (!(await isFeatureFlagOwner(request.headers))) {
    return noStore({ success: false, error: "Forbidden" }, 403);
  }
  if (request.method !== "GET" && !trustedOrigin(request)) {
    return noStore({ success: false, error: "Forbidden" }, 403);
  }
  return null;
}

async function readJson(request: NextRequest) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  return request.json().catch(() => null);
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return noStore(
      { success: false, error: error.issues.map((issue) => issue.message).join("; ") },
      400,
    );
  }
  if (error instanceof TeamCompLookupError) {
    return noStore(
      { success: false, error: error.message, candidates: error.candidates },
      error.status,
    );
  }
  console.error("[team-comp] request failed", error);
  return noStore({ success: false, error: "Unable to load or update team comp" }, 500);
}

export async function GET(request: NextRequest) {
  try {
    const denied = await ownerAccess(request);
    if (denied) return denied;
    const params = request.nextUrl.searchParams;
    if (params.has("query")) {
      const query = z.string().trim().min(2).max(100).parse(params.get("query"));
      const teams = await searchTeamsForComp(query);
      return noStore({ success: true, teams: teams.map(describeTeamComp) });
    }
    const target = targetSchema.parse({
      teamId: params.get("teamId") ?? undefined,
      email: params.get("email") ?? undefined,
    });
    const team = await findTeamForComp(target);
    return noStore({ success: true, comp: describeTeamComp(team) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const denied = await ownerAccess(request);
    if (denied) return denied;
    const body = await readJson(request);
    if (!body) return noStore({ success: false, error: "JSON body required" }, 415);
    const input = setSchema.parse(body);
    const team = await findTeamForComp(input);
    const updated = await setTeamComp(team, { plan: input.plan, until: input.until }, FEATURE_FLAG_OWNER_USER_ID);
    return noStore({ success: true, comp: describeTeamComp(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const denied = await ownerAccess(request);
    if (denied) return denied;
    const body = await readJson(request);
    if (!body) return noStore({ success: false, error: "JSON body required" }, 415);
    const team = await findTeamForComp(targetSchema.parse(body));
    const updated = await setTeamComp(team, null, FEATURE_FLAG_OWNER_USER_ID);
    return noStore({ success: true, comp: describeTeamComp(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}
