import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import {
  projectTimeTrackingResponse,
  projectTimeTrackingUpdate,
  projectTimeTrackingUpdateGuard,
} from "@/lib/projectTimeTrackingSettings";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const projectId = Number(body?.projectId);
  const data = projectTimeTrackingUpdate(body);
  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !data
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "projectId and a time-tracking setting are required",
      },
      { status: 400 }
    );
  }

  const result = await prisma.project.updateMany({
    where: {
      id: projectId,
      ...getProjectWhere(session.userId),
      ...projectTimeTrackingUpdateGuard(data),
    },
    data,
  });

  if (result.count === 0) {
    return NextResponse.json(
      { success: false, error: "Board not found or access denied" },
      { status: 404 }
    );
  }

  return NextResponse.json(projectTimeTrackingResponse(data));
}
