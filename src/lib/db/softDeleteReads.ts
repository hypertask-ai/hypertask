export const SOFT_DELETE_MODELS = ["Task", "Project"] as const;

export const SOFT_DELETE_READ_OPERATIONS = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
] as const;

const MODELS: ReadonlySet<string> = new Set(SOFT_DELETE_MODELS);
const READ_OPERATIONS: ReadonlySet<string> = new Set(SOFT_DELETE_READ_OPERATIONS);

export const VISIBLE_ROW_STATUS = { not: "Deleted" } as const;

export const anyStatus: { status: { in: ("Normal" | "Archive" | "Deleted")[] } } = {
  status: { in: ["Normal", "Archive", "Deleted"] },
};

type WhereRecord = Record<string, unknown>;

export type SoftDeleteReadArgs = {
  model?: string | null;
  operation: string;
  args?: unknown;
  query: (args?: unknown) => Promise<unknown>;
};

function isRecord(value: unknown): value is WhereRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function whereConstrainsStatus(where: unknown): boolean {
  if (!isRecord(where)) return false;
  if (where.status !== undefined) return true;
  return ["AND", "OR", "NOT"].some((key) => {
    const value = where[key];
    if (Array.isArray(value)) return value.some(whereConstrainsStatus);
    return whereConstrainsStatus(value);
  });
}

export function guardedWhere(where: unknown): WhereRecord {
  if (!isRecord(where)) return { status: VISIBLE_ROW_STATUS };
  return { ...where, status: VISIBLE_ROW_STATUS };
}

export async function guardSoftDeleteRead({
  model,
  operation,
  args,
  query,
}: SoftDeleteReadArgs): Promise<unknown> {
  if (!model || !MODELS.has(model) || !READ_OPERATIONS.has(operation)) {
    return query(args);
  }
  const input = isRecord(args) ? args : {};
  if (whereConstrainsStatus(input.where)) return query(args);
  return query({ ...input, where: guardedWhere(input.where) });
}

export function excludeDeletedRows() {
  return {
    name: "excludeDeletedRows",
    query: { $allOperations: guardSoftDeleteRead },
  };
}
