import { readJsonBody } from "@/lib/mcp/readJsonBody";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  CustomFieldValidationError,
  reorderCustomFields,
} from "@/utils/controllers/customFields";

export async function POST(request: NextRequest) {
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

    let body: Awaited<ReturnType<typeof request.json>>;
    let jsonError: unknown;
    const result = await readJsonBody<typeof body>({
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
    if (result.ok) body = result.body;
    const { projectId, orderedFieldIds } = body;
    if (!projectId || !Array.isArray(orderedFieldIds)) {
      return NextResponse.json(
        { error: "projectId and orderedFieldIds are required" },
        { status: 400 }
      );
    }

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
