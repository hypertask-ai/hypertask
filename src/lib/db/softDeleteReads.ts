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

type TaskStatus = "Normal" | "Archive" | "Deleted";

const DELETED: TaskStatus = "Deleted";
const MODELS: ReadonlySet<string> = new Set(SOFT_DELETE_MODELS);
const READ_OPERATIONS: ReadonlySet<string> = new Set(SOFT_DELETE_READ_OPERATIONS);

export const VISIBLE_ROW_STATUS = { not: DELETED } as const;

export type AnyStatusScope = {
  anyStatus: true;
  status: { in: TaskStatus[] };
};

export const anyStatusMarker: { anyStatus: true } = { anyStatus: true };

export const anyStatus: AnyStatusScope = {
  ...anyStatusMarker,
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

export function isAnyStatusRead(where: unknown): boolean {
  return isRecord(where) && where.anyStatus === true;
}

export function withoutAnyStatusMarker(where: WhereRecord): WhereRecord {
  const rest: WhereRecord = {};
  for (const [key, value] of Object.entries(where)) {
    if (key !== "anyStatus") rest[key] = value;
  }
  return rest;
}

function isLiveStatus(value: unknown): boolean {
  return value === "Normal" || value === "Archive";
}

export function statusExcludesDeleted(status: unknown): boolean {
  if (isLiveStatus(status)) return true;
  if (!isRecord(status)) return false;
  if (isLiveStatus(status.equals)) return true;
  if (status.not === DELETED) return true;
  return Array.isArray(status.in) && status.in.length > 0 && status.in.every(isLiveStatus);
}

export function guardedWhere(where: unknown): WhereRecord {
  const scope = isRecord(where) ? where : {};
  if (statusExcludesDeleted(scope.status)) return scope;
  return { ...scope, status: VISIBLE_ROW_STATUS };
}

export async function guardSoftDeleteRead({
  model,
  operation,
  args,
  query,
}: SoftDeleteReadArgs): Promise<unknown> {
  if (!model || !MODELS.has(model)) return query(args);
  const input = isRecord(args) ? args : {};
  if (isAnyStatusRead(input.where)) {
    return query({ ...input, where: withoutAnyStatusMarker(input.where as WhereRecord) });
  }
  if (!READ_OPERATIONS.has(operation)) return query(args);
  const where = guardedWhere(input.where);
  if (where === input.where) return query(args);
  return query({ ...input, where });
}
