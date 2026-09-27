import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { HTPR_6653_ADMIN_TEAM_COMP_FLAG, isFeatureEnabled } from "@/lib/flags";
import {
  checkMcpRateLimit,
  createUnauthorizedResponse,
  validateManagementOrSessionAuth,
} from "@/lib/mcp/auth";
import { TEAM_COMP_PLANS } from "@/lib/teamComp";
import {
  describeTeamComp,
  findTeamForComp,
  isTeamCompAdmin,
  setTeamComp,
  TeamCompLookupError,
} from "@/lib/teamCompAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// HTPR-6653: owner-only. Comp a team as Pro or BYOK until a date, or clear the comp.

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
    until: z.coerce
      .date()
      .refine((date) => date.getTime() > Date.now(), "until must be in the future"),
  }),
);

type Access = { userId: number } | { response: NextResponse };

async function ownerAccess(request: NextRequest, action: "read" | "write"): Promise<Access> {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return { response: rateLimited };
  const ctx = await validateManagementOrSessionAuth(request, action);
  if (!ctx) return { response: createUnauthorizedResponse() };
  // Team-scoped keys and every other account are rejected, whatever the flag says.
  if (ctx.management?.teamId || !isTeamCompAdmin(ctx.user)) {
    return { response: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }) };
  }
  if (!(await isFeatureEnabled(HTPR_6653_ADMIN_TEAM_COMP_FLAG, ctx.user.id))) {
    return { response: NextResponse.json({ success: false, error: "Not found" }, { status: 404 }) };
  }
  return { userId: ctx.user.id };
}

async function readJson(request: NextRequest) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  return request.json().catch(() => null);
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, error: error.issues.map((issue) => issue.message).join("; ") },
      { status: 400 },
    );
  }
  if (error instanceof TeamCompLookupError) {
    return NextResponse.json(
      { success: false, error: error.message, candidates: error.candidates },
      { status: error.status },
    );
  }
  console.error("[team-comp] request failed", error);
  return NextResponse.json({ success: false, error: "Unable to update team comp" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const access = await ownerAccess(request, "read");
  if ("response" in access) return access.response;
  try {
    const params = request.nextUrl.searchParams;
    const target = targetSchema.parse({
      teamId: params.get("teamId") ?? undefined,
      email: params.get("email") ?? undefined,
    });
    const team = await findTeamForComp(target);
    return NextResponse.json({ success: true, comp: describeTeamComp(team) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const access = await ownerAccess(request, "write");
  if ("response" in access) return access.response;
  try {
    const body = await readJson(request);
    if (!body) {
      return NextResponse.json({ success: false, error: "JSON body required" }, { status: 415 });
    }
    const input = setSchema.parse(body);
    const team = await findTeamForComp(input);
    const updated = await setTeamComp(team, { plan: input.plan, until: input.until }, access.userId);
    return NextResponse.json({ success: true, comp: describeTeamComp(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const access = await ownerAccess(request, "write");
  if ("response" in access) return access.response;
  try {
    const body = await readJson(request);
    if (!body) {
      return NextResponse.json({ success: false, error: "JSON body required" }, { status: 415 });
    }
    const team = await findTeamForComp(targetSchema.parse(body));
    const updated = await setTeamComp(team, null, access.userId);
    return NextResponse.json({ success: true, comp: describeTeamComp(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}
