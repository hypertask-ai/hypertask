import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  CustomFieldValidationError,
  getCustomFieldForProjectById,
  upsertCustomFieldValue,
} from "@/utils/controllers/customFields";

/**
 * POST /api/customFields/value
 * Upserts (or clears) a custom field value on a task.
 * Body: { fieldId, taskId, value }
 * Empty/null value deletes the row.
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
    const { fieldId, taskId, value } = body;

    if (!fieldId || !taskId) {
      return NextResponse.json(
        { error: "fieldId and taskId are required" },
        { status: 400 }
      );
    }

    // Verify the task belongs to a project the user is a member of
    const task = await prisma.task.findUnique({
      where: { id: parseInt(taskId) },
      select: { projectId: true },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Owner-or-member, same predicate as the MCP twin route (validateProjectAccess) —
    // a bare Member lookup 403s a board OWNER who has no Member row (HTPR-3805).
    const project = await prisma.project.findFirst({
      where: { id: task.projectId, ...getProjectWhere(user.id) },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const customField = await getCustomFieldForProjectById(
      task.projectId,
      String(fieldId)
    );
    if (!customField) {
      return NextResponse.json(
        { error: "Custom field not found on the task's project" },
        { status: 404 }
      );
    }

    const result = await upsertCustomFieldValue(
      customField.id,
      parseInt(taskId),
      value ?? null
    );

    return NextResponse.json(result ?? { deleted: true });
  } catch (error) {
    if (error instanceof CustomFieldValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("POST /api/customFields/value error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
