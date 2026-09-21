import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextRequest, NextResponse } from "next/server";

// Default idle window when a board turns auto-archive on (Linear parity: 6 months).
// Not exported: Next.js route files only allow method/config exports.
const AUTO_ARCHIVE_DEFAULT_DAYS = 180;

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
  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    typeof body?.enabled !== "boolean"
  ) {
    return NextResponse.json(
      { success: false, error: "projectId and enabled are required" },
      { status: 400 }
    );
  }
  const days = body.days;
  if (
    body.enabled &&
    days !== undefined &&
    (!Number.isInteger(days) || days <= 0 || days > 36500)
  ) {
    return NextResponse.json(
      { success: false, error: "days must be between 1 and 36500" },
      { status: 400 }
    );
  }
  const autoArchiveAfterDays = body.enabled
    ? (days ?? AUTO_ARCHIVE_DEFAULT_DAYS)
    : null;

  const result = await prisma.project.updateMany({
    where: {
      id: projectId,
      ...getProjectWhere(session.userId),
    },
    data: { autoArchiveAfterDays },
  });

  if (result.count === 0) {
    return NextResponse.json(
      { success: false, error: "Board not found or access denied" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    enabled: body.enabled,
    autoArchiveAfterDays,
  });
}
