export type CoreActionsFixture = {
  projectId: number;
  taskId: number;
  baseSectionId: number;
  altSectionId: number;
  userId: number;
  userDisplayName: string;
  agentId: string;
  agentDisplayName: string;
};

export class SmokeFailure extends Error {
  constructor(
    readonly kind: "application" | "unrunnable",
    readonly action: string,
    readonly status: number | undefined,
    readonly detail: string,
    readonly transportFailure = false,
  ) {
    super(`${action}: ${detail}`);
  }
}

export const toSmokeFailure = (error: unknown, action: string) => {
  if (error instanceof SmokeFailure) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new SmokeFailure("application", action, undefined, detail);
};

export type JsonResponse = {
  status: number;
  data: any;
};

export const safeDetail = (data: unknown, hasBody: boolean) => {
  if (!data || typeof data !== "object")
    return hasBody ? "non-JSON response" : "empty response";
  const value = data as Record<string, unknown>;
  const safe = {
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
  const text = JSON.stringify(safe);
  return (text === "{}" ? "response details omitted" : text).slice(0, 240);
};

export const escapeHtml = (value: string | number) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const commentsFrom = (data: any) =>
  Array.isArray(data?.comments) ? data.comments : null;

export const assigneeHasUser = (task: any, userId: number) =>
  Array.isArray(task?.assignees) &&
  task.assignees.some(
    (row: any) =>
      Number(row?.userId ?? row?.user?.id) === userId && !row?.agentId,
  );

export const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null;

export const classifyUnexpectedResponse = (
  status: number,
  data: unknown,
): "application" | "unrunnable" => {
  if (status === 429) return "unrunnable";
  if (status === 500 && isRecord(data)) {
    const hasApplicationError = [data.code, data.error, data.message].some(
      (value) => typeof value === "string" && value.length > 0,
    );
    if (hasApplicationError) return "application";
  }
  return status >= 500 ? "unrunnable" : "application";
};

export const commentCreatorId = (comment: any) =>
  Number(comment?.creatorId ?? comment?.creator?.id);

export const isFixtureActivity = (comment: any, fixture: CoreActionsFixture) => {
  const activity = isRecord(comment?.activity) ? comment.activity : null;
  const data = isRecord(activity?.data) ? activity.data : null;
  if (!activity || !data || Number(data.fromUserId) !== fixture.userId)
    return false;

  if (activity.type === "TaskMove") {
    const from = Number(
      isRecord(data.fromSection) ? data.fromSection.sectionId : undefined,
    );
    const to = Number(
      isRecord(data.toSection) ? data.toSection.sectionId : undefined,
    );
    const fixtureSections = new Set([
      fixture.baseSectionId,
      fixture.altSectionId,
    ]);
    return fixtureSections.has(from) && fixtureSections.has(to);
  }

  if (activity.type === "TaskAssigned") {
    const toUser = isRecord(data.toUser) ? data.toUser : null;
    return (
      Number(toUser?.userId) === fixture.userId &&
      (data.updatedStatus === "Assigned" || data.updatedStatus === "Unassigned")
    );
  }

  return false;
};

export const ownedIdsFromMarker = (comment: any) => {
  if (typeof comment?.text !== "string") return [];
  const encoded = comment.text.match(/data-core-smoke-ids="([0-9,]*)"/)?.[1];
  if (!encoded) return [];
  return encoded.split(",").map(Number).filter(Number.isSafeInteger);
};
