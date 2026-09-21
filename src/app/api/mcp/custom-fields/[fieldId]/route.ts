import { logger as htLogger } from "#logger";
import { withoutAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";

import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { deleteCustomField, getCustomFieldById } from "@/utils/controllers/customFields";

/** DELETE /api/mcp/custom-fields/[fieldId] */
async function DELETEHandler(
  request: NextRequest,
  props: { params: Promise<{ fieldId: string }> }
) {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;

    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized. Invalid or missing authentication token.",
        },
        { status: 401 }
      );
    }

    const { fieldId } = await props.params;

    const field = await getCustomFieldById(fieldId);
    if (!field) {
      return NextResponse.json(
        { success: false, error: "Custom field not found" },
        { status: 404 }
      );
    }

    const access = await validateProjectAccess(
      field.projectId,
      ctx.user.id,
      ctx.agentId
    );
    if (access.error) {
      return NextResponse.json(
        { success: false, error: access.error.message },
        { status: access.error.status }
      );
    }

    const result = await deleteCustomField(fieldId);
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Custom field not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedValues: result.deletedValues,
      message: `Custom field "${result.field.name}" deleted`,
    });
  } catch (error) {
    htLogger.error("[MCP Custom Fields] Delete error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const DELETE = withoutAuth(DELETEHandler);
