import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  CustomFieldValidationError,
  reorderCustomFields,
} from "@/utils/controllers/customFields";

/**
 * POST /api/customFields/reorder
 * Persists drag-to-reorder from the manage-custom-fields modal.
 * Body: { projectId, orderedFieldIds: string[] } — must list exactly this
 * board's fields, once each.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    const { isValid, user } = isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, orderedFieldIds } = body;
    if (!projectId || !Array.isArray(orderedFieldIds)) {
      return NextResponse.json(
        { error: "projectId and orderedFieldIds are required" },
        { status: 400 }
      );
    }

    // Owner-or-member, same predicate as the sibling customFields routes —
    // a bare Member lookup 403s a board OWNER who has no Member row (HTPR-3805).
    const project = await prisma.project.findFirst({
      where: { id: parseInt(projectId), ...getProjectWhere(user.id) },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const fields = await reorderCustomFields(parseInt(projectId), orderedFieldIds);
    return NextResponse.json(fields);
  } catch (error) {
    if (error instanceof CustomFieldValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("POST /api/customFields/reorder error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
