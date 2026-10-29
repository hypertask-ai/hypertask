import { withAgentScopeRequest } from "@/lib/auth/agentScope";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { readJsonBody } from "@/lib/mcp/readJsonBody";
import { loadCurrentUser } from "@/lib/auth/currentUser";
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

export async function POST(request: NextRequest) {
  return withAgentScopeRequest(request, () => setCustomFieldValue(request));
}

async function setCustomFieldValue(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null);
    const { isValid, user } = currentUser
      ? { isValid: true, user: currentUser.user }
      : isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const actingAgentId = (await getSessionUser(request.headers).catch(() => null))?.agentId;

    let body: Awaited<ReturnType<typeof request.json>>;
    let jsonError: unknown;
    const bodyResult = await readJsonBody<typeof body>({
      json: async () => {
        try {
          body = await request.json();
          return body;
        } catch (error) {
          jsonError = error;
          throw error;
        }
      },
    } as Request, {
      invalidJson: () => { throw jsonError },
      invalidObject: () => NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 }),
    });
    if (bodyResult.ok) body = bodyResult.body;
    const { fieldId, taskId, value } = body;

    if (!fieldId || !taskId) {
      return NextResponse.json(
        { error: "fieldId and taskId are required" },
        { status: 400 }
      );
    }

    const task = await prisma.task.findUnique({
      where: {
        id: parseInt(taskId),
        ...(actingAgentId ? { project: getProjectWhere(user.id, actingAgentId) } : {}),
      },
      select: { projectId: true },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const project = await prisma.project.findFirst({
      where: {
        id: task.projectId,
        ...getProjectWhere(user.id),
        ...(actingAgentId ? { AND: [getProjectWhere(user.id, actingAgentId)] } : {}),
      },
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
