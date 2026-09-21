import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  CustomFieldValidationError,
  createCustomField,
  deleteCustomField,
  getCustomFieldById,
  getCustomFieldsForProject,
  updateCustomField,
} from "@/utils/controllers/customFields";
import { CustomFieldType } from "@prisma/client";

/**
 * GET /api/customFields?projectId=<id>
 * Lists custom fields for a board (ordered by ranking).
 */
async function GETHandler(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    const { isValid, user } = isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectIdStr = request.nextUrl.searchParams.get("projectId");
    if (!projectIdStr) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const projectId = parseInt(projectIdStr);

    // Owner-or-member, same predicate as the MCP twin route — a bare Member
    // lookup 403s a board OWNER who has no Member row (HTPR-3805).
    const project = await prisma.project.findFirst({
      where: { id: projectId, ...getProjectWhere(user.id) },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const fields = await getCustomFieldsForProject(projectId);
    return NextResponse.json(fields);
  } catch (error) {
    htLogger.error("GET /api/customFields error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/customFields
 * Creates a custom field for a board.
 * Body: { projectId, name, type, options? }
 */
async function POSTHandler(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    const { isValid, user } = isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, name, type, options } = body;

    if (!projectId || !name || !type) {
      return NextResponse.json(
        { error: "projectId, name, and type are required" },
        { status: 400 }
      );
    }

    if (!Object.values(CustomFieldType).includes(type as CustomFieldType)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    // Owner-or-member, same predicate as the MCP twin route — a bare Member
    // lookup 403s a board OWNER who has no Member row (HTPR-3805).
    const project = await prisma.project.findFirst({
      where: { id: parseInt(projectId), ...getProjectWhere(user.id) },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const field = await createCustomField(
      parseInt(projectId),
      name,
      type as CustomFieldType,
      options
    );
    return NextResponse.json(field, { status: 201 });
  } catch (error) {
    if (error instanceof CustomFieldValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    htLogger.error("POST /api/customFields error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/customFields
 * Renames a field and/or flips its rail/table visibility.
 * Body: { fieldId, name?, showInRail?, showInTable? }
 */
async function PATCHHandler(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    const { isValid, user } = isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { fieldId, name, showInRail, showInTable } = body;
    if (!fieldId) {
      return NextResponse.json({ error: "fieldId required" }, { status: 400 });
    }

    const field = await getCustomFieldById(fieldId);
    if (!field) {
      return NextResponse.json({ error: "Custom field not found" }, { status: 404 });
    }

    // Owner-or-member, same predicate as the sibling customFields routes —
    // a bare Member lookup 403s a board OWNER who has no Member row (HTPR-3805).
    const project = await prisma.project.findFirst({
      where: { id: field.projectId, ...getProjectWhere(user.id) },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updated = await updateCustomField(fieldId, {
      name,
      showInRail,
      showInTable,
    });
    if (!updated) {
      return NextResponse.json({ error: "Custom field not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof CustomFieldValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    htLogger.error("PATCH /api/customFields error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/customFields?fieldId=<id>
 * Deletes a custom field and its values (cascade via schema onDelete).
 */
async function DELETEHandler(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    const { isValid, user } = isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const fieldId = request.nextUrl.searchParams.get("fieldId");
    if (!fieldId) {
      return NextResponse.json({ error: "fieldId required" }, { status: 400 });
    }

    const field = await getCustomFieldById(fieldId);
    if (!field) {
      return NextResponse.json({ error: "Custom field not found" }, { status: 404 });
    }

    // Owner-or-member, same predicate as the MCP twin route — a bare Member
    // lookup 403s a board OWNER who has no Member row (HTPR-3805).
    const project = await prisma.project.findFirst({
      where: { id: field.projectId, ...getProjectWhere(user.id) },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await deleteCustomField(fieldId);
    if (!result) {
      return NextResponse.json({ error: "Custom field not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedValues: result.deletedValues });
  } catch (error) {
    htLogger.error("DELETE /api/customFields error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withAuth(GETHandler, { authenticateInHandler: true });
export const POST = withAuth(POSTHandler, { authenticateInHandler: true });
export const PATCH = withAuth(PATCHHandler, { authenticateInHandler: true });
export const DELETE = withAuth(DELETEHandler, { authenticateInHandler: true });
