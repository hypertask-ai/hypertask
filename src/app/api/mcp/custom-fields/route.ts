import { CustomFieldType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import {
  CustomFieldValidationError,
  createCustomField,
  getCustomFieldsForProject,
  type CustomFieldOption,
} from "@/utils/controllers/customFields";

const MCP_CUSTOM_FIELD_TYPES = ["Number", "Text", "Select", "Date"] as const;
type McpCustomFieldType = (typeof MCP_CUSTOM_FIELD_TYPES)[number];

function unauthorizedResponse() {
  return NextResponse.json(
    {
      success: false,
      error: "Unauthorized. Invalid or missing authentication token.",
    },
    { status: 401 }
  );
}

function validationError(error: string, field: string, code: string) {
  return NextResponse.json(
    { success: false, error, details: { field, code } },
    { status: 400 }
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsePositiveIntegerParam(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;

  const parsed = Number(value.trim());
  return isPositiveInteger(parsed) ? parsed : null;
}

function isMcpCustomFieldType(value: unknown): value is McpCustomFieldType {
  return (
    typeof value === "string" &&
    MCP_CUSTOM_FIELD_TYPES.includes(value as McpCustomFieldType)
  );
}

function isCustomFieldOptions(value: unknown): value is CustomFieldOption[] {
  return (
    Array.isArray(value) &&
    value.every(
      (option) =>
        option !== null &&
        typeof option === "object" &&
        !Array.isArray(option) &&
        typeof (option as CustomFieldOption).id === "string" &&
        (option as CustomFieldOption).id.trim().length > 0 &&
        typeof (option as CustomFieldOption).label === "string" &&
        (option as CustomFieldOption).label.trim().length > 0 &&
        ((option as CustomFieldOption).color === undefined ||
          typeof (option as CustomFieldOption).color === "string")
    )
  );
}

async function authenticate(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return { response: rateLimited, ctx: null };

  const ctx = await validateMcpAuth(request);
  if (!ctx) return { response: unauthorizedResponse(), ctx: null };

  return { response: null, ctx };
}

/** GET /api/mcp/custom-fields?project_id=123 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (!auth.ctx) return auth.response!;

    const rawProjectId = request.nextUrl.searchParams.get("project_id");
    const projectId = parsePositiveIntegerParam(rawProjectId);
    if (projectId === null) {
      return validationError(
        "project_id must be a positive integer",
        "project_id",
        rawProjectId === null ? "missing_field" : "invalid_format"
      );
    }

    const access = await validateProjectAccess(
      projectId,
      auth.ctx.user.id,
      auth.ctx.agentId
    );
    if (access.error) {
      return NextResponse.json(
        { success: false, error: access.error.message },
        { status: access.error.status }
      );
    }

    const customFields = await getCustomFieldsForProject(projectId);
    return NextResponse.json({ success: true, projectId, customFields });
  } catch (error) {
    console.error("[MCP Custom Fields] List error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** POST /api/mcp/custom-fields */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (!auth.ctx) return auth.response!;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return validationError(
        "Request body must be valid JSON",
        "body",
        "invalid_format"
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return validationError(
        "Request body must be a JSON object",
        "body",
        "invalid_type"
      );
    }

    const { project_id, name, type = "Number", options } = body as {
      project_id?: unknown;
      name?: unknown;
      type?: unknown;
      options?: unknown;
    };

    if (!isPositiveInteger(project_id)) {
      return validationError(
        "project_id must be a positive integer",
        "project_id",
        project_id === undefined ? "missing_field" : "invalid_type"
      );
    }

    if (typeof name !== "string" || name.trim().length === 0) {
      return validationError(
        "name is required and must be a non-empty string",
        "name",
        name === undefined ? "missing_field" : "invalid_type"
      );
    }

    if (!isMcpCustomFieldType(type)) {
      return validationError(
        `type must be one of: ${MCP_CUSTOM_FIELD_TYPES.join(", ")}`,
        "type",
        "invalid_value"
      );
    }

    if (options !== undefined && !isCustomFieldOptions(options)) {
      return validationError(
        "options must be an array of objects with non-empty id and label strings",
        "options",
        "invalid_type"
      );
    }

    const access = await validateProjectAccess(
      project_id,
      auth.ctx.user.id,
      auth.ctx.agentId
    );
    if (access.error) {
      return NextResponse.json(
        { success: false, error: access.error.message },
        { status: access.error.status }
      );
    }

    const customField = await createCustomField(
      project_id,
      name,
      type as CustomFieldType,
      options
    );

    return NextResponse.json({
      success: true,
      customField,
      message: `Custom field "${customField.name}" is ready`,
    });
  } catch (error) {
    if (error instanceof CustomFieldValidationError) {
      return validationError(error.message, error.field, "invalid_value");
    }
    console.error("[MCP Custom Fields] Create error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
