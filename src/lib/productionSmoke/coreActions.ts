import { CoreSmokeRunDeadlineError } from "@/lib/productionSmoke/lock";

const MARKER_PREFIX = "[core-actions-smoke:";

export const CORE_SMOKE_BOARD_TITLE = "Hypertask production core-actions smoke";
export const CORE_SMOKE_TASK_TITLE = "Core actions smoke fixture";
export const CORE_SMOKE_BASE_SECTION = "Baseline";
export const CORE_SMOKE_ALT_SECTION = "Alternate";
export const CORE_SMOKE_AGENT_NAME = "Core Actions Smoke Agent";
export const CORE_SMOKE_RUN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

type FetchLike = typeof fetch;

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

export type CoreActionsSmokeResult = {
  ok: boolean;
  kind: "pass" | "application" | "unrunnable";
  action: string;
  status?: number;
  detail: string;
  steps: string[];
  cleanup: string[];
};

class SmokeFailure extends Error {
  constructor(
    readonly kind: "application" | "unrunnable",
    readonly action: string,
    readonly status: number | undefined,
    readonly detail: string,
  ) {
    super(`${action}: ${detail}`);
  }
}

const toSmokeFailure = (error: unknown, action: string) => {
  if (error instanceof SmokeFailure) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new SmokeFailure("application", action, undefined, detail);
};

type JsonResponse = {
  status: number;
  data: any;
};

const safeDetail = (data: unknown, hasBody: boolean) => {
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

const escapeHtml = (value: string | number) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const commentsFrom = (data: any) =>
  Array.isArray(data?.comments) ? data.comments : null;

const assigneeHasUser = (task: any, userId: number) =>
  Array.isArray(task?.assignees) &&
  task.assignees.some(
    (row: any) =>
      Number(row?.userId ?? row?.user?.id) === userId && !row?.agentId,
  );

const isRecord = (value: unknown): value is Record<string, any> =>
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

const commentCreatorId = (comment: any) =>
  Number(comment?.creatorId ?? comment?.creator?.id);

const isFixtureActivity = (comment: any, fixture: CoreActionsFixture) => {
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

const ownedIdsFromMarker = (comment: any) => {
  if (typeof comment?.text !== "string") return [];
  const encoded = comment.text.match(/data-core-smoke-ids="([0-9,]*)"/)?.[1];
  if (!encoded) return [];
  return encoded.split(",").map(Number).filter(Number.isSafeInteger);
};

export async function runCoreActionsSmoke(options: {
  baseUrl: string;
  cookieHeader: string;
  fixture: CoreActionsFixture;
  runId: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  persistOwnership?: boolean;
}): Promise<CoreActionsSmokeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!CORE_SMOKE_RUN_ID_PATTERN.test(options.runId)) {
    return {
      ok: false,
      kind: "unrunnable",
      action: "configure smoke run",
      detail: "run ID is invalid",
      steps: [],
      cleanup: [],
    };
  }
  let baseUrl: string;
  try {
    baseUrl = new URL(options.baseUrl).origin;
  } catch {
    return {
      ok: false,
      kind: "unrunnable",
      action: "configure smoke origin",
      detail: "base URL is invalid",
      steps: [],
      cleanup: [],
    };
  }
  const fixture = options.fixture;
  const steps: string[] = [];
  const cleanup: string[] = [];
  let markerId: number | null = null;
  let originalRank: string | undefined;
  let cleanupAuthorized = false;
  const marker = `${MARKER_PREFIX}${escapeHtml(options.runId)}]`;
  const knownCommentIds = new Set<number>();
  const ownedCommentIds = new Set<number>();
  let cleaningUp = false;

  const markerText = () =>
    `<p data-core-smoke-ids="${[...ownedCommentIds].sort((a, b) => a - b).join(",")}">${marker} User and agent mention check: <span data-type="mention" class="mention" data-id="${escapeHtml(fixture.userDisplayName)}" data-label="name-${fixture.userId}" uniqueindex="" projectid="">${escapeHtml(fixture.userDisplayName)}</span> <span data-type="mention" class="mention" data-id="${escapeHtml(fixture.agentDisplayName)}" data-label="agent-${escapeHtml(fixture.agentId)}">${escapeHtml(fixture.agentDisplayName)}</span></p>`;

  const request = async (
    action: string,
    path: string,
    init: RequestInit = {},
    accept: readonly number[] = [200],
  ): Promise<JsonResponse> => {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, baseUrl), {
        ...init,
        redirect: "manual",
        signal:
          options.signal &&
          (!cleaningUp ||
            !(options.signal.reason instanceof CoreSmokeRunDeadlineError))
            ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
        headers: {
          Cookie: options.cookieHeader,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new SmokeFailure(
        "unrunnable",
        action,
        undefined,
        error instanceof Error ? error.message : "network request failed",
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new SmokeFailure(
        "unrunnable",
        action,
        response.status,
        error instanceof Error
          ? error.message
          : "response body could not be read",
      );
    }
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (response.headers.get("x-vercel-mitigated") === "challenge") {
      throw new SmokeFailure(
        "unrunnable",
        action,
        response.status,
        "Vercel challenge",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new SmokeFailure(
        "unrunnable",
        action,
        response.status,
        "test session rejected",
      );
    }
    if (response.status >= 300 && response.status < 400) {
      throw new SmokeFailure(
        "unrunnable",
        action,
        response.status,
        "unexpected redirect",
      );
    }
    if (!accept.includes(response.status)) {
      throw new SmokeFailure(
        classifyUnexpectedResponse(response.status, data),
        action,
        response.status,
        safeDetail(data, Boolean(text)),
      );
    }
    if (text && data === null) {
      throw new SmokeFailure(
        "application",
        action,
        response.status,
        "response was not JSON",
      );
    }
    return { status: response.status, data };
  };

  const getTask = async (action: string) => {
    const { data } = await request(
      action,
      `/api/tasks/single?id=${fixture.taskId}`,
    );
    if (
      Number(data?.id) !== fixture.taskId ||
      Number(data?.projectId) !== fixture.projectId
    ) {
      throw new SmokeFailure(
        "application",
        action,
        200,
        "response did not contain the fixture task",
      );
    }
    return data;
  };

  const getBoardTask = async (action: string) => {
    const { data } = await request(action, "/api/projects/boardTasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: fixture.projectId,
        userId: fixture.userId,
      }),
    });
    const task = Array.isArray(data?.tasks)
      ? data.tasks.find(
          (row: unknown) => isRecord(row) && Number(row.id) === fixture.taskId,
        )
      : null;
    if (!task) {
      throw new SmokeFailure(
        "application",
        action,
        200,
        "fixture task was missing from boardTasks",
      );
    }
    return task;
  };

  const getComments = async (action: string) => {
    const { data } = await request(
      action,
      `/api/comments/getByTask?taskId=${fixture.taskId}`,
    );
    const comments = commentsFrom(data);
    if (!comments) {
      throw new SmokeFailure(
        "application",
        action,
        200,
        "response did not contain a comments array",
      );
    }
    return comments;
  };

  const move = async (
    action: string,
    sectionId: number,
    sectionTitle: string,
    ranking?: string,
  ) => {
    return request(action, "/api/tasks/moveTask", {
      method: "PUT",
      body: JSON.stringify({
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        sectionId,
        section_title: sectionTitle,
        ...(ranking ? { ranking } : {}),
      }),
    });
  };

  const assign = async (action: string, intent: "assign" | "unassign") => {
    return request(action, "/api/assignees/assign", {
      method: "POST",
      body: JSON.stringify({
        userId: fixture.userId,
        taskId: fixture.taskId,
        intent,
      }),
    });
  };

  const rememberCommentIds = (comments: any[]) => {
    for (const comment of comments) {
      const id = Number(comment?.id);
      if (Number.isSafeInteger(id)) knownCommentIds.add(id);
    }
  };

  const persistOwnedCommentIds = async () => {
    if (markerId === null || options.persistOwnership === false) return;
    await request("record smoke ownership", "/api/comments/updateComment", {
      method: "PUT",
      body: JSON.stringify({
        text: markerText(),
        creatorId: fixture.userId,
        taskId: fixture.taskId,
        commentId: markerId,
      }),
    });
  };

  const captureNewFixtureActivity = async (
    action: string,
    requireOne: boolean,
    persist: boolean,
  ) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const comments = await getComments(action);
      const candidates = [];
      for (const comment of comments) {
        const id = Number(comment?.id);
        if (!Number.isSafeInteger(id) || knownCommentIds.has(id)) continue;
        knownCommentIds.add(id);
        if (isFixtureActivity(comment, fixture)) candidates.push(id);
      }
      if (candidates.length > 1) {
        throw new SmokeFailure(
          "unrunnable",
          action,
          200,
          "activity ownership was ambiguous",
        );
      }
      if (candidates.length === 1) {
        ownedCommentIds.add(candidates[0]);
        if (persist) await persistOwnedCommentIds();
        return;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!requireOne) return;
    throw new SmokeFailure(
      "application",
      action,
      200,
      "the mutation activity was not visible on re-read",
    );
  };

  const captureReturnedMoveActivity = async (
    action: string,
    response: JsonResponse,
    persist: boolean,
  ) => {
    const id = Number(response.data?.newComment?.id);
    if (!Number.isSafeInteger(id)) {
      throw new SmokeFailure(
        "application",
        action,
        200,
        "move response did not contain its activity id",
      );
    }
    const comments = await getComments(action);
    const activity = comments.find(
      (comment: any) => Number(comment?.id) === id,
    );
    if (!activity || !isFixtureActivity(activity, fixture)) {
      throw new SmokeFailure(
        "application",
        action,
        200,
        "move activity was not visible on re-read",
      );
    }
    rememberCommentIds(comments);
    ownedCommentIds.add(id);
    if (persist) await persistOwnedCommentIds();
  };

  const deleteOwnedComments = async () => {
    for (const id of [...ownedCommentIds].sort((a, b) => b - a)) {
      await request(
        "cleanup comment delete",
        "/api/comments/deleteCommentById",
        {
          method: "POST",
          body: JSON.stringify({ id }),
        },
        [200, 404],
      );
    }
    const remaining = (await getComments("cleanup comments verify")).some(
      (comment: any) => ownedCommentIds.has(Number(comment?.id)),
    );
    if (remaining) {
      throw new SmokeFailure(
        "application",
        "cleanup comments",
        200,
        "run comments remained after cleanup",
      );
    }
  };

  const reconcile = async () => {
    const task = await getTask("fixture preflight task");
    originalRank = typeof task.ranking === "string" ? task.ranking : undefined;
    const comments = await getComments("fixture preflight comments");
    rememberCommentIds(comments);
    const staleMarkers = comments
      .map((comment: any) => ({
        comment,
        marker:
          typeof comment?.text === "string"
            ? comment.text.match(
                /\[core-actions-smoke:[A-Za-z0-9._:-]{1,100}\]/,
              )?.[0]
            : undefined,
      }))
      .filter(
        ({ comment, marker }: any) =>
          commentCreatorId(comment) === fixture.userId && marker,
      );
    if (staleMarkers.length > 0) {
      cleanupAuthorized = true;
      const firstMarkerId = Math.min(
        ...staleMarkers
          .map(({ comment }: any) => Number(comment?.id))
          .filter(Number.isSafeInteger),
      );
      for (const { comment } of staleMarkers) {
        const id = Number(comment.id);
        if (Number.isSafeInteger(id)) ownedCommentIds.add(id);
        for (const ownedId of ownedIdsFromMarker(comment)) {
          const owned = comments.find(
            (candidate: any) => Number(candidate?.id) === ownedId,
          );
          if (owned && isFixtureActivity(owned, fixture))
            ownedCommentIds.add(ownedId);
        }
      }
      for (const comment of comments) {
        const id = Number(comment?.id);
        if (
          Number.isSafeInteger(id) &&
          id > firstMarkerId &&
          isFixtureActivity(comment, fixture)
        ) {
          ownedCommentIds.add(id);
        }
      }
      if (Number(task.sectionId) !== fixture.baseSectionId) {
        const recoveryMove = await move(
          "recover interrupted move",
          fixture.baseSectionId,
          CORE_SMOKE_BASE_SECTION,
          originalRank,
        );
        await captureReturnedMoveActivity(
          "capture recovery move activity",
          recoveryMove,
          false,
        );
      }
      if (assigneeHasUser(task, fixture.userId)) {
        await assign("recover interrupted assignment", "unassign");
        await captureNewFixtureActivity(
          "capture recovery assignment activity",
          true,
          false,
        );
      }
      await deleteOwnedComments();
      ownedCommentIds.clear();
    }

    const cleanTask = await getTask("fixture baseline verify");
    if (Number(cleanTask.sectionId) !== fixture.baseSectionId) {
      throw new SmokeFailure(
        "unrunnable",
        "fixture baseline",
        200,
        "fixture is not in Baseline",
      );
    }
    if (assigneeHasUser(cleanTask, fixture.userId)) {
      throw new SmokeFailure(
        "unrunnable",
        "fixture baseline",
        200,
        "test user is already assigned",
      );
    }
    originalRank =
      typeof cleanTask.ranking === "string" ? cleanTask.ranking : originalRank;
    cleanupAuthorized = true;
  };

  let failure: SmokeFailure | null = null;
  try {
    await reconcile();

    await getBoardTask("open board");
    steps.push("open board");

    await getTask("open task");
    steps.push("open task");

    const initialComments = await getComments("load comments");
    rememberCommentIds(initialComments);
    steps.push("load comments");

    const created = await request(
      "post comment and mentions",
      "/api/comments/create",
      {
        method: "POST",
        body: JSON.stringify({
          text: markerText(),
          creatorId: fixture.userId,
          taskId: fixture.taskId,
          ownerId: fixture.userId,
        }),
      },
    );
    const createdMarkerId = Number(created.data?.id);
    if (!Number.isInteger(createdMarkerId)) {
      throw new SmokeFailure(
        "application",
        "post comment and mentions",
        200,
        "response did not contain a comment id",
      );
    }
    markerId = createdMarkerId;
    knownCommentIds.add(markerId);
    ownedCommentIds.add(markerId);
    await persistOwnedCommentIds();
    const reread = await getComments("verify comment and mentions");
    const saved = reread.find(
      (comment: any) => Number(comment?.id) === markerId,
    );
    if (
      !saved?.text?.includes(marker) ||
      !saved.text.includes(`name-${fixture.userId}`) ||
      !saved.text.includes(`agent-${fixture.agentId}`)
    ) {
      throw new SmokeFailure(
        "application",
        "verify comment and mentions",
        200,
        "saved comment or mentions were missing",
      );
    }
    steps.push("post comment and mention user and agent");

    // The move dialog is fed by this pages route, not MCP; a board whose
    // column list crashed used to escape the smoke entirely (HTPR-6259).
    const columns = await request(
      "load move-to-column columns",
      "/api/section/getProjectSections",
      {
        method: "POST",
        body: JSON.stringify({ projectId: fixture.projectId }),
      },
    );
    if (!Array.isArray(columns.data) || columns.data.length === 0) {
      throw new SmokeFailure(
        "application",
        "load move-to-column columns",
        200,
        Array.isArray(columns.data)
          ? "the move-to-column column list was empty"
          : "response was not a columns array",
      );
    }
    // A non-empty list is not enough: the move below targets Alternate, so the
    // dialog has to offer both fixture columns or the move is untestable.
    const offeredSections = new Set(
      columns.data.map((column: any) => Number(column?.id)),
    );
    if (
      !offeredSections.has(fixture.baseSectionId) ||
      !offeredSections.has(fixture.altSectionId)
    ) {
      throw new SmokeFailure(
        "application",
        "load move-to-column columns",
        200,
        "the move-to-column list was missing a fixture column",
      );
    }
    steps.push("load move-to-column columns");

    const moveResponse = await move(
      "move task",
      fixture.altSectionId,
      CORE_SMOKE_ALT_SECTION,
      originalRank,
    );
    await captureReturnedMoveActivity(
      "capture move activity",
      moveResponse,
      true,
    );
    const moved = await getTask("verify move");
    if (Number(moved.sectionId) !== fixture.altSectionId) {
      throw new SmokeFailure(
        "application",
        "verify move",
        200,
        "task did not move to Alternate",
      );
    }
    steps.push("move task");

    await assign("assign user", "assign");
    await captureNewFixtureActivity("capture assignment activity", true, true);
    const assigned = await getBoardTask("verify assignment");
    if (!assigneeHasUser(assigned, fixture.userId)) {
      throw new SmokeFailure(
        "application",
        "verify assignment",
        200,
        "test user was not assigned",
      );
    }
    await assign("unassign user", "unassign");
    await captureNewFixtureActivity(
      "capture unassignment activity",
      true,
      true,
    );
    const unassigned = await getBoardTask("verify unassignment");
    if (assigneeHasUser(unassigned, fixture.userId)) {
      throw new SmokeFailure(
        "application",
        "verify unassignment",
        200,
        "test user remained assigned",
      );
    }
    steps.push("assign and unassign");

    const search = await request("search", "/api/search/document", {
      method: "POST",
      body: JSON.stringify({
        searchQuery: CORE_SMOKE_TASK_TITLE,
        projectIds: [fixture.projectId],
        archive: null,
      }),
    });
    const hits = search.data?.processedData?.All;
    if (
      !Array.isArray(hits) ||
      !hits.some((hit: any) => Number(hit?.taskId) === fixture.taskId)
    ) {
      throw new SmokeFailure(
        "application",
        "search",
        200,
        "fixture task was missing from search results",
      );
    }
    steps.push("search");
  } catch (error) {
    failure = toSmokeFailure(error, "core actions");
  } finally {
    cleaningUp = true;
    if (!cleanupAuthorized) {
      cleanup.push("skipped: this run did not own fixture state");
    } else {
      try {
        if (markerId === null) {
          const comments = await getComments("cleanup marker discovery");
          const discovered = comments.find(
            (comment: any) =>
              commentCreatorId(comment) === fixture.userId &&
              typeof comment?.text === "string" &&
              comment.text.includes(marker),
          );
          if (Number.isSafeInteger(Number(discovered?.id))) {
            markerId = Number(discovered.id);
            knownCommentIds.add(markerId);
            ownedCommentIds.add(markerId);
          }
        }
        await captureNewFixtureActivity(
          "capture pending mutation activity",
          false,
          true,
        );
        const task = await getTask("cleanup task read");
        if (Number(task.sectionId) !== fixture.baseSectionId) {
          const cleanupMove = await move(
            "cleanup move",
            fixture.baseSectionId,
            CORE_SMOKE_BASE_SECTION,
            originalRank,
          );
          await captureReturnedMoveActivity(
            "capture cleanup move activity",
            cleanupMove,
            true,
          );
          cleanup.push("restored section and rank");
        }
        const current = await getTask("cleanup assignment read");
        if (assigneeHasUser(current, fixture.userId)) {
          await assign("cleanup assignment", "unassign");
          await captureNewFixtureActivity(
            "capture cleanup assignment activity",
            true,
            true,
          );
          cleanup.push("removed test-user assignment");
        }
        if (ownedCommentIds.size > 0) {
          await deleteOwnedComments();
          cleanup.push("deleted run comments and activity");
        }
        const restored = await getTask("cleanup verify");
        if (
          Number(restored.sectionId) !== fixture.baseSectionId ||
          (originalRank !== undefined && restored.ranking !== originalRank) ||
          assigneeHasUser(restored, fixture.userId)
        ) {
          throw new SmokeFailure(
            "application",
            "cleanup verify",
            200,
            "fixture state was not restored",
          );
        }
      } catch (error) {
        const cleanupFailure = toSmokeFailure(error, "cleanup");
        if (!failure) {
          failure = cleanupFailure;
        } else if (
          failure.kind === "application" ||
          cleanupFailure.kind === "unrunnable"
        ) {
          failure = new SmokeFailure(
            failure.kind,
            failure.action,
            failure.status,
            `${failure.detail}; cleanup failed at ${cleanupFailure.action}: ${cleanupFailure.detail}`,
          );
        } else {
          failure = new SmokeFailure(
            cleanupFailure.kind,
            cleanupFailure.action,
            cleanupFailure.status,
            `${cleanupFailure.detail}; followed ${failure.action}: ${failure.detail}`,
          );
        }
        cleanup.push(`failed: ${cleanupFailure.action}`);
      }
    }
  }

  if (failure) {
    return {
      ok: false,
      kind: failure.kind,
      action: failure.action,
      ...(failure.status !== undefined ? { status: failure.status } : {}),
      detail: failure.detail,
      steps,
      cleanup,
    };
  }

  return {
    ok: true,
    kind: "pass",
    action: "complete",
    detail: "all core actions passed and the fixture was restored",
    steps,
    cleanup,
  };
}
