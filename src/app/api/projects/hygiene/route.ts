import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getBoardHygiene } from "@/utils/controllers/projects/hygiene";

export async function GET(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }
  const report = await getBoardHygiene(projectId, session.userId, session.agentId, session.teamScope);
  if (!report) return NextResponse.json({ error: "Board not found or access denied" }, { status: 404 });
  return NextResponse.json({ success: true, projectId, report });
}
