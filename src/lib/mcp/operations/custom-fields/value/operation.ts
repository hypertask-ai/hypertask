import { CustomFieldType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import {
  CustomFieldValidationError,
  createCustomField,
  getCustomFieldForProjectById,
  getCustomFieldForProjectByName,
  upsertCustomFieldValue,
} from "@/utils/controllers/customFields";

function validationError(error: string, field: string, code: string) {
  return NextResponse.json(
    { success: false, error, details: { field, code } },
    { status: 400 }
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** POST /api/mcp/custom-fields/value */
export async function POST(request: NextRequest) {
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

    const requestBody = body as {
      task_id?: unknown;
      field_id?: unknown;
      field_name?: unknown;
      value?: unknown;
    };
    const { task_id, field_id, field_name, value } = requestBody;

    if (!isPositiveInteger(task_id)) {
      return validationError(
        "task_id must be a positive integer",
        "task_id",
        task_id === undefined ? "missing_field" : "invalid_type"
      );
    }

    const hasFieldId = typeof field_id === "string" && field_id.trim().length > 0;
    const hasFieldName =
      typeof field_name === "string" && field_name.trim().length > 0;
    if (hasFieldId === hasFieldName) {
      return validationError(
        "Provide exactly one of field_id or field_name",
        "field_id",
        "invalid_field_combination"
      );
    }

    if (!Object.prototype.hasOwnProperty.call(requestBody, "value")) {
      return validationError("value is required", "value", "missing_field");
    }

    if (
      value !== null &&
      typeof value !== "string" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      return validationError(
        "value must be a string, finite number, or null",
        "value",
        "invalid_type"
      );
    }

    const task = await prisma.task.findUnique({
      where: { id: task_id },
      select: { id: true, projectId: true, status: true },
    });
    if (!task || task.status === "Deleted") {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    const access = await validateProjectAccess(
      task.projectId,
      ctx.user.id,
      ctx.agentId
    );
    if (access.error) {
      return NextResponse.json(
        { success: false, error: "Task not found or access denied" },
        { status: access.error.status === 404 ? 404 : 403 }
      );
    }

    const normalizedValue = value === null ? null : String(value);
    let customField;
    if (hasFieldId) {
      customField = await getCustomFieldForProjectById(
        task.projectId,
        field_id.trim()
      );
      if (!customField) {
        return NextResponse.json(
          {
            success: false,
            error: "Custom field not found on the task's project",
          },
          { status: 404 }
        );
      }
    } else {
      const trimmedFieldName = (field_name as string).trim();
      customField = await getCustomFieldForProjectByName(
        task.projectId,
        trimmedFieldName
      );
      if (!customField && normalizedValue !== null && normalizedValue !== "") {
        customField = await createCustomField(
          task.projectId,
          trimmedFieldName,
          CustomFieldType.Number
        );
      }
    }

    if (!customField) {
      return NextResponse.json({
        success: true,
        taskId: task.id,
        customField: null,
        customFieldValue: null,
        deleted: true,
      });
    }

    const customFieldValue = await upsertCustomFieldValue(
      customField.id,
      task.id,
      normalizedValue
    );

    return NextResponse.json({
      success: true,
      taskId: task.id,
      customField: {
        id: customField.id,
        name: customField.name,
        type: customField.type,
      },
      customFieldValue,
      ...(customFieldValue === null ? { deleted: true } : {}),
    });
  } catch (error) {
    if (error instanceof CustomFieldValidationError) {
      return validationError(error.message, error.field, "invalid_value");
    }
    console.error("[MCP Custom Fields] Set value error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
