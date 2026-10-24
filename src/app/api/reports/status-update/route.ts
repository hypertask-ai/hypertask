import { withAgentScopeRequest } from "@/lib/auth/agentScope";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  generateStatusUpdateReport,
  StatusUpdateBoardNotFoundError,
  StatusUpdateGenerationError,
  StatusUpdatesDisabledError,
} from "@/utils/controllers/reports/statusUpdate";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  return withAgentScopeRequest(request, () => generateStatusUpdate(request));
}

async function generateStatusUpdate(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const projectId = Number(body?.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  try {
    const update = await generateStatusUpdateReport({
      projectId,
      userId: session.userId,
      actingAgentId: session.agentId ?? null,
      teamScope: session.teamScope,
      range: body?.range,
    });
    return NextResponse.json({
      success: true,
      url: update.url,
      headline: update.headline,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TeamKeyOnlyRefusal") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof StatusUpdateBoardNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof StatusUpdatesDisabledError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof StatusUpdateGenerationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }
}
