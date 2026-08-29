import prisma from "@/lib/prisma";
import { CustomFieldType, type Prisma } from "@prisma/client";

export interface CustomFieldOption {
  id: string;
  label: string;
  color?: string;
}

export const CUSTOM_FIELD_NAME_MAX_LENGTH = 64;
export const CUSTOM_FIELDS_PER_PROJECT_MAX = 50;
const CUSTOM_FIELD_CREATE_MAX_ATTEMPTS = 3;

export class CustomFieldValidationError extends Error {
  readonly field: "name" | "value" | "order";

  constructor(field: "name" | "value" | "order", message: string) {
    super(message);
    this.name = "CustomFieldValidationError";
    this.field = field;
  }
}

function normalizeCustomFieldName(name: string) {
  if (typeof name !== "string") {
    throw new CustomFieldValidationError(
      "name",
      "Custom field name must be a string"
    );
  }
  return name.trim().slice(0, CUSTOM_FIELD_NAME_MAX_LENGTH);
}

export async function createCustomField(
  projectId: number,
  name: string,
  type: CustomFieldType,
  options?: CustomFieldOption[]
) {
  const normalizedName = normalizeCustomFieldName(name);
  if (!normalizedName) {
    throw new CustomFieldValidationError("name", "Custom field name is required");
  }

  const normalizedOptions: Prisma.InputJsonObject[] | undefined = options?.map(
    ({ id, label, color }) => ({
      id,
      label,
      ...(color !== undefined ? { color } : {}),
    })
  );

  for (
    let attempt = 0;
    attempt < CUSTOM_FIELD_CREATE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.customField.findUnique({
            where: { projectId_name: { projectId, name: normalizedName } },
          });
          if (existing) return existing;

          const fieldCount = await tx.customField.count({
            where: { projectId },
          });
          if (fieldCount >= CUSTOM_FIELDS_PER_PROJECT_MAX) {
            throw new CustomFieldValidationError(
              "name",
              `A board can have at most ${CUSTOM_FIELDS_PER_PROJECT_MAX} custom fields`
            );
          }

          // Append after existing fields: find max ranking and increment
          const last = await tx.customField.findFirst({
            where: { projectId },
            orderBy: { ranking: "desc" },
            select: { ranking: true },
          });
          const nextRanking = last?.ranking
            ? String(parseInt(last.ranking) + 1).padStart(6, "0")
            : "000001";

          return tx.customField.create({
            data: {
              projectId,
              name: normalizedName,
              type,
              options: normalizedOptions,
              ranking: nextRanking,
            },
          });
        },
        { isolationLevel: "Serializable" }
      );
    } catch (error) {
      if (
        !["P2002", "P2034"].includes(
          (error as { code?: string })?.code ?? ""
        ) ||
        attempt === CUSTOM_FIELD_CREATE_MAX_ATTEMPTS - 1
      ) {
        throw error;
      }
    }
  }

  throw new Error("Unable to create custom field");
}

// valueCount rides along so the manage-fields modal's delete confirm can show
// "N tickets carry a value" without a separate round trip per field.
export async function getCustomFieldsForProject(projectId: number) {
  const fields = await prisma.customField.findMany({
    where: { projectId },
    orderBy: { ranking: "asc" },
    include: { _count: { select: { values: true } } },
  });
  return fields.map(({ _count, ...field }) => ({
    ...field,
    valueCount: _count.values,
  }));
}

export async function getCustomFieldForProjectById(
  projectId: number,
  fieldId: string
) {
  return prisma.customField.findFirst({
    where: { id: fieldId, projectId },
  });
}

export async function getCustomFieldById(fieldId: string) {
  return prisma.customField.findUnique({ where: { id: fieldId } });
}

/**
 * Deletes a custom field. CustomFieldValue rows cascade via the schema's
 * onDelete: Cascade, so counting them here (inside the same transaction, so
 * the count can't drift from what's about to be deleted) is purely for the
 * caller to report the blast radius. Returns null if the field doesn't exist.
 */
export async function deleteCustomField(fieldId: string) {
  return prisma.$transaction(async (tx) => {
    const field = await tx.customField.findUnique({ where: { id: fieldId } });
    if (!field) return null;

    const deletedValues = await tx.customFieldValue.count({ where: { fieldId } });
    await tx.customField.delete({ where: { id: fieldId } });
    return { field, deletedValues };
  });
}

/**
 * Rename a field and/or flip its rail/table visibility. Returns null if the
 * field doesn't exist or the patch is empty.
 */
export async function updateCustomField(
  fieldId: string,
  patch: { name?: string; showInRail?: boolean; showInTable?: boolean }
) {
  const data: Prisma.CustomFieldUpdateInput = {};
  if (patch.name !== undefined) {
    const normalizedName = normalizeCustomFieldName(patch.name);
    if (!normalizedName) {
      throw new CustomFieldValidationError("name", "Custom field name is required");
    }
    data.name = normalizedName;
  }
  if (patch.showInRail !== undefined) data.showInRail = patch.showInRail;
  if (patch.showInTable !== undefined) data.showInTable = patch.showInTable;
  if (Object.keys(data).length === 0) return null;

  try {
    return await prisma.customField.update({ where: { id: fieldId }, data });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2025") return null; // not found
    if ((error as { code?: string })?.code === "P2002") {
      throw new CustomFieldValidationError(
        "name",
        "A field with that name already exists on this board"
      );
    }
    throw error;
  }
}

/**
 * Persists a drag-to-reorder from the manage-fields modal. Renumbers every
 * field on the board sequentially (fields cap at 50, so a full renumber is
 * cheap and avoids a lexical-midpoint scheme just for this list).
 */
export async function reorderCustomFields(
  projectId: number,
  orderedFieldIds: string[]
) {
  return prisma.$transaction(async (tx) => {
    const fields = await tx.customField.findMany({
      where: { projectId },
      select: { id: true },
    });
    const validIds = new Set(fields.map((f) => f.id));
    if (
      orderedFieldIds.length !== fields.length ||
      orderedFieldIds.some((id) => !validIds.has(id))
    ) {
      throw new CustomFieldValidationError(
        "order",
        "orderedFieldIds must list exactly this board's fields, once each"
      );
    }

    await Promise.all(
      orderedFieldIds.map((id, index) =>
        tx.customField.update({
          where: { id },
          data: { ranking: String(index + 1).padStart(6, "0") },
        })
      )
    );

    return tx.customField.findMany({
      where: { projectId },
      orderBy: { ranking: "asc" },
    });
  });
}

export async function getCustomFieldForProjectByName(
  projectId: number,
  name: string
) {
  return prisma.customField.findUnique({
    where: {
      projectId_name: { projectId, name: normalizeCustomFieldName(name) },
    },
  });
}

/**
 * Upsert a custom field value. Empty/null value deletes the row (clearing).
 * Validates type-specific values and computes the numeric sort key.
 */
export async function upsertCustomFieldValue(
  fieldId: string,
  taskId: number,
  value: string | number | null
) {
  if (
    value !== null &&
    typeof value !== "string" &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new CustomFieldValidationError(
      "value",
      "Custom field value must be a string, finite number, or null"
    );
  }

  const stringValue = value === null ? null : String(value);
  if (stringValue === null || stringValue === "") {
    await prisma.customFieldValue.deleteMany({ where: { fieldId, taskId } });
    return null;
  }

  const field = await prisma.customField.findUnique({
    where: { id: fieldId },
    select: { type: true, options: true },
  });

  let normalizedValue = stringValue;
  let numericValue: number | null = null;
  if (field?.type === "Number") {
    const parsed = Number(stringValue);
    if (stringValue.trim() === "" || !Number.isFinite(parsed)) {
      throw new CustomFieldValidationError(
        "value",
        "Number custom field value must be a valid number"
      );
    }
    numericValue = parsed;
  } else if (field?.type === "Date") {
    const parsed = Date.parse(stringValue);
    if (Number.isNaN(parsed)) {
      throw new CustomFieldValidationError(
        "value",
        "Date custom field value must be a valid date"
      );
    }
    numericValue = parsed;
  } else if (field?.type === "Select") {
    const options = Array.isArray(field.options) ? field.options : [];
    const option = options.find(
      (candidate) =>
        candidate !== null &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        ((typeof candidate.id === "string" && candidate.id === stringValue) ||
          (typeof candidate.label === "string" &&
            candidate.label === stringValue))
    );
    if (
      option === undefined ||
      option === null ||
      typeof option !== "object" ||
      Array.isArray(option) ||
      typeof option.label !== "string"
    ) {
      throw new CustomFieldValidationError(
        "value",
        "Select custom field value must match an option id or label"
      );
    }
    normalizedValue = option.label;
  }

  return prisma.customFieldValue.upsert({
    where: { fieldId_taskId: { fieldId, taskId } },
    create: { fieldId, taskId, value: normalizedValue, numericValue },
    update: { value: normalizedValue, numericValue },
  });
}
