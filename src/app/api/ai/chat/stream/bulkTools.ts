export type ToolTaskIdentifierInput = {
  task_id?: number;
  ticket_number?: string;
  unique_index?: number;
  project_id?: number;
};

export type BulkTaskIdentifierInput = ToolTaskIdentifierInput & {
  task_ids?: number[];
  ticket_numbers?: string[];
};

export type BulkOperationSubject =
  | {
      identifier: ToolTaskIdentifierInput;
      resolvedTaskId: number | null;
    }
  | { key: string };

function bulkOperationSubject(subject: BulkOperationSubject) {
  if ("key" in subject) {
    return { key: subject.key, sortKey: `subject:${subject.key}` };
  }
  if (subject.resolvedTaskId !== null) {
    return {
      key: `task:${subject.resolvedTaskId}`,
      sortKey: `task:${String(subject.resolvedTaskId).padStart(16, "0")}`,
    };
  }

  const identifier = subject.identifier;
  const key = `unresolved:${JSON.stringify([
    identifier.task_id ?? null,
    identifier.ticket_number?.trim().toLowerCase() ?? null,
    identifier.unique_index ?? null,
    identifier.project_id ?? null,
  ])}`;
  return { key, sortKey: key };
}

// Models rephrase identifiers between messages; resolved subjects remain stable.
export function buildBulkOperationKey(
  intent: string,
  subjects: BulkOperationSubject[],
  changes: unknown[] = []
) {
  return JSON.stringify([
    intent,
    subjects
      .map(bulkOperationSubject)
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
      .map(({ key }) => key),
    [...changes].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    ),
  ]);
}

export type TaskIdentifierMatch = { id: number; projectId: number };

export function decideTaskIdentifierMatch(options: {
  taskId?: number;
  ticketNumber?: string;
  projectId?: number;
  taskMatch: TaskIdentifierMatch | null;
  ticketMatch: TaskIdentifierMatch | null;
  unscopedTaskMatch?: TaskIdentifierMatch | null;
}): { match: TaskIdentifierMatch | null; error?: string } {
  const {
    taskId,
    ticketNumber,
    projectId,
    taskMatch,
    ticketMatch,
    unscopedTaskMatch,
  } = options;
  const projectConflict =
    taskId !== undefined &&
    projectId !== undefined &&
    !taskMatch &&
    unscopedTaskMatch &&
    unscopedTaskMatch.projectId !== projectId;

  if (projectConflict) {
    return {
      match: null,
      error:
        `Identifier conflict: ` +
        (ticketNumber && ticketMatch
          ? `ticket_number=${ticketNumber} resolves to task_id=${ticketMatch.id} in project_id=${ticketMatch.projectId}, while `
          : "") +
        `task_id=${taskId} belongs to project_id=${unscopedTaskMatch.projectId}, not project_id=${projectId}.`,
    };
  }

  if (taskId !== undefined && ticketNumber) {
    if (!ticketMatch) {
      return {
        match: null,
        error: `Identifier conflict: ticket_number=${ticketNumber} did not resolve; task_id=${taskId} was not used because ticket_number takes precedence.`,
      };
    }
    if (taskMatch && taskMatch.id !== ticketMatch.id) {
      return {
        match: null,
        error: `Identifier conflict: ticket_number=${ticketNumber} resolves to task_id=${ticketMatch.id} in project_id=${ticketMatch.projectId}, while task_id=${taskId} resolves to task_id=${taskMatch.id} in project_id=${taskMatch.projectId}.`,
      };
    }
    return { match: ticketMatch };
  }

  return { match: ticketNumber ? ticketMatch : taskMatch };
}

export function buildLimitedScanMetadata(scanned: number, limit: number) {
  return {
    total: Math.min(scanned, limit),
    truncated: scanned > limit,
  };
}

export function buildCollectionMetadata(total: number, returned: number) {
  return { total, truncated: returned < total };
}

export function buildSearchTotalMetadata(
  total: number,
  candidateSetLimited: boolean
) {
  return {
    total,
    total_is_lower_bound: candidateSetLimited,
    total_scope: candidateSetLimited ? "candidate_set" : "all_database_matches",
  };
}

export function resolveBulkTaskTargets(
  input: BulkTaskIdentifierInput
): ToolTaskIdentifierInput[] {
  const bulkTargets: ToolTaskIdentifierInput[] = [
    ...(input.task_ids ?? []).map((task_id) => ({ task_id })),
    ...(input.ticket_numbers ?? []).map((ticket_number) => ({
      ticket_number,
      project_id: input.project_id,
    })),
  ];
  return bulkTargets.length
    ? bulkTargets
    : [{
        task_id: input.task_id,
        ticket_number: input.ticket_number,
        unique_index: input.unique_index,
        project_id: input.project_id,
      }];
}

/** Tag-only edits: reversible, and scoped to a single task property. */
export const LABEL_UPDATE_FIELDS = [
  "labels",
  "add_labels",
  "remove_labels",
] as const;

/** Every hypertask_update_task field that changes something a user can see. */
export const UPDATE_TASK_CHANGE_FIELDS = [
  "title",
  "description",
  "priority",
  "estimate",
  "due_date",
  "status",
  "parent_task_id",
  "section",
  ...LABEL_UPDATE_FIELDS,
] as const;

/**
 * HTPR-4218 shows a wide or destructive write to the user before it runs.
 *
 * HTPR-5536: retagging is exempt. It is reversible and scoped to one property,
 * so a confirmation is pure friction, and the round-trip itself only completes
 * when the model repeats the byte-identical call, which is why tags often never
 * landed at all. Destructive statuses and wide non-label rewrites still confirm.
 */
export function updateTasksNeedConfirmation<T extends object>(input: {
  targetCount: number;
  update: T;
}): boolean {
  const { targetCount } = input;
  const update = input.update as Record<string, unknown>;

  // Deleting always confirms. Archive is reversible, so a single archive stays
  // one-shot; only a sweep of them gets shown first.
  if (update.status === "Deleted") return true;
  if (update.status === "Archive" && targetCount >= 2) return true;

  const changedFields = UPDATE_TASK_CHANGE_FIELDS.filter(
    (field) => update[field] !== undefined
  );
  const labelOnly =
    changedFields.length > 0 &&
    changedFields.every((field) =>
      (LABEL_UPDATE_FIELDS as readonly string[]).includes(field)
    );
  if (labelOnly) return false;

  return targetCount >= 4;
}

export type UserReference = number | string;
export type ProjectMemberIdentity = {
  id: number;
  displayName?: string | null;
  email?: string | null;
};
export type ProjectAgentIdentity = {
  id: string;
  displayName?: string | null;
};
export type ProjectAssigneeIdentity =
  | ProjectMemberIdentity
  | ProjectAgentIdentity;

export function resolveUserIds(
  input: { user_ids?: number[]; users?: UserReference[] },
  currentUserId: number,
  members: ProjectAssigneeIdentity[]
) {
  const userIds: number[] = [];
  const agentIds: string[] = [];
  const failures: { user: UserReference; error: string }[] = [];
  const seenUserIds = new Set<number>();
  const seenAgentIds = new Set<string>();
  const humanMembers = members.filter(
    (member): member is ProjectMemberIdentity => typeof member.id === "number"
  );
  const boardAgents = members.filter(
    (member): member is ProjectAgentIdentity => typeof member.id === "string"
  );

  for (const reference of [...(input.user_ids ?? []), ...(input.users ?? [])]) {
    let userId: number | undefined;
    let agentId: string | undefined;
    if (typeof reference === "number") {
      userId = reference;
    } else {
      const normalized = reference.trim().toLowerCase();
      if (normalized === "me") {
        userId = currentUserId;
      } else {
        const humanMatches = humanMembers.filter(
          (member) =>
            member.displayName?.trim().toLowerCase() === normalized ||
            member.email?.trim().toLowerCase() === normalized
        );
        const agentMatches = boardAgents.filter(
          (agent) =>
            agent.id.toLowerCase() === normalized ||
            agent.displayName?.trim().toLowerCase() === normalized
        );

        if (humanMatches.length > 0 && agentMatches.length > 0) {
          failures.push({
            user: reference,
            error: `Both a project member and a board agent match "${reference}". Use the person's email or user id, or the agent's UUID.`,
          });
          continue;
        }
        if (humanMatches.length === 1) {
          userId = humanMatches[0].id;
        } else if (humanMatches.length > 1) {
          failures.push({
            user: reference,
            error: `Multiple project members match "${reference}"; use their email address or user id.`,
          });
          continue;
        } else if (agentMatches.length === 1) {
          agentId = agentMatches[0].id;
        } else if (agentMatches.length > 1) {
          failures.push({
            user: reference,
            error: `Multiple board agents match "${reference}"; use the agent UUID.`,
          });
          continue;
        } else {
          failures.push({
            user: reference,
            error: `No project member or board agent on this task's board matches "${reference}".`,
          });
          continue;
        }
      }
    }

    if (agentId) {
      if (!seenAgentIds.has(agentId)) {
        seenAgentIds.add(agentId);
        agentIds.push(agentId);
      }
      continue;
    }

    if (
      userId === undefined ||
      !humanMembers.some((member) => member.id === userId)
    ) {
      failures.push({
        user: reference,
        error: `User ${userId} is not a member of this project.`,
      });
      continue;
    }
    if (!seenUserIds.has(userId)) {
      seenUserIds.add(userId);
      userIds.push(userId);
    }
  }

  return { userIds, agentIds, failures };
}

export type ToolExecutionSummaryInput = {
  name: string;
  result: unknown;
};

function resultObject(result: unknown): Record<string, unknown> | null {
  return typeof result === "object" && result !== null
    ? (result as Record<string, unknown>)
    : null;
}

function resultFailures(result: unknown): unknown[] {
  const object = resultObject(result);
  return object && Array.isArray(object.failures) ? object.failures : [];
}

export function toolResultSucceeded(result: unknown) {
  return resultObject(result)?.success === true && resultFailures(result).length === 0;
}

export function toolResultPartiallySucceeded(result: unknown) {
  return resultObject(result)?.success === true && resultFailures(result).length > 0;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function successfulTaskCount(result: Record<string, unknown>) {
  if (Array.isArray(result.tasks)) return result.tasks.length;
  if (result.task) return 1;
  return 0;
}

function formatWriteSummary(
  name: string,
  executions: ToolExecutionSummaryInput[],
  currentUserId?: number
) {
  const results = executions
    .map((execution) => resultObject(execution.result))
    .filter((result): result is Record<string, unknown> => Boolean(result));
  const failed = results.reduce(
    (count, result) => count + resultFailures(result).length,
    0
  );
  const uncountedFailures = results.filter(
    (result) => result.success !== true && resultFailures(result).length === 0
  ).length;

  if (name === "hypertask_assign_user" || name === "hypertask_unassign_user") {
    const changed = results.reduce(
      (count, result) =>
        count + (typeof result.changed === "number" ? result.changed : 0),
      0
    );
    const changedTasks = results.flatMap((result) =>
      Array.isArray(result.tasks)
        ? result.tasks.filter(
            (task) =>
              typeof task === "object" &&
              task !== null &&
              typeof (task as { changed?: unknown }).changed === "number" &&
              Number((task as { changed: number }).changed) > 0
          )
        : []
    );
    const changedUserIds = changedTasks.flatMap((task) => {
      const ids = (task as { changed_user_ids?: unknown }).changed_user_ids;
      return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : [];
    });
    const changedAgentIds = changedTasks.flatMap((task) => {
      const ids = (task as { changed_agent_ids?: unknown }).changed_agent_ids;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    });
    const includesAgents =
      changedAgentIds.length > 0 ||
      results.some((result) =>
        resultFailures(result).some(
          (failure) =>
            typeof failure === "object" &&
            failure !== null &&
            typeof (failure as { agent?: unknown }).agent === "string"
        )
      );
    const pairNoun = includesAgents ? "task-assignee" : "task-user";
    const verb = name === "hypertask_assign_user" ? "assigned" : "unassigned";
    const preposition = name === "hypertask_assign_user" ? "to" : "from";
    const onlyCurrentUser =
      changedAgentIds.length === 0 &&
      changedUserIds.length > 0 &&
      changedUserIds.every((id) => id === currentUserId);
    const success =
      changed === 0
        ? failed > 0 || uncountedFailures > 0
          ? `No ${name === "hypertask_assign_user" ? "assignment" : "unassignment"} changes succeeded.`
          : `No ${name === "hypertask_assign_user" ? "assignment" : "unassignment"} changes were needed.`
        : onlyCurrentUser
          ? `I ${verb} you ${preposition} ${changedTasks.length} ${plural(changedTasks.length, "task")}.`
          : `I ${verb} ${changed} ${pairNoun} ${plural(changed, "pair")} across ${changedTasks.length} ${plural(changedTasks.length, "task")}.`;
    const countedFailureSummary =
      failed > 0
        ? ` ${failed} ${pairNoun} ${plural(failed, "change")} failed.`
        : "";
    const uncountedFailureSummary =
      uncountedFailures > 0
        ? ` ${uncountedFailures} tool ${plural(uncountedFailures, "call")} failed before entity counts were available.`
        : "";
    return `${success}${countedFailureSummary}${uncountedFailureSummary}`;
  }

  const succeeded = results.reduce(
    (count, result) => count + successfulTaskCount(result),
    0
  );
  const action =
    name === "hypertask_create_task"
      ? "created"
      : name === "hypertask_update_task"
        ? "updated"
        : name === "hypertask_add_comment"
          ? "commented on"
          : null;
  if (action) {
    const success =
      succeeded > 0
        ? `I ${action} ${succeeded} ${plural(succeeded, "task")}.`
        : "No task changes succeeded.";
    const countedFailureSummary =
      failed > 0 ? ` ${failed} ${plural(failed, "task")} failed.` : "";
    const uncountedFailureSummary =
      uncountedFailures > 0
        ? ` ${uncountedFailures} tool ${plural(uncountedFailures, "call")} failed before entity counts were available.`
        : "";
    return `${success}${countedFailureSummary}${uncountedFailureSummary}`;
  }

  const completed = results.filter((result) => toolResultSucceeded(result)).length;
  if (completed === 0 && failed === 0 && uncountedFailures === 0) return null;
  const success =
    completed > 0
      ? `I completed ${completed} ${plural(completed, "write action")}.`
      : "No write actions succeeded.";
  const countedFailureSummary =
    failed > 0
      ? ` ${failed} ${plural(failed, "write action")} failed.`
      : "";
  const uncountedFailureSummary =
    uncountedFailures > 0
      ? ` ${uncountedFailures} tool ${plural(uncountedFailures, "call")} failed before entity counts were available.`
      : "";
  return `${success}${countedFailureSummary}${uncountedFailureSummary}`;
}

export function buildEmptyCompletionSummary(options: {
  toolExecutions: ToolExecutionSummaryInput[];
  writeToolNames: ReadonlySet<string>;
  reachedStepLimit: boolean;
  maxToolSteps: number;
  currentUserId?: number;
}) {
  const writes = options.toolExecutions.filter((execution) =>
    options.writeToolNames.has(execution.name)
  );
  const grouped = new Map<string, ToolExecutionSummaryInput[]>();
  for (const execution of writes) {
    grouped.set(execution.name, [...(grouped.get(execution.name) ?? []), execution]);
  }
  const summaries = [...grouped.entries()].flatMap(([name, executions]) => {
    const summary = formatWriteSummary(name, executions, options.currentUserId);
    return summary ? [summary] : [];
  });

  const cause = options.reachedStepLimit
    ? `I reached the ${options.maxToolSteps}-step processing limit.`
    : "The model returned no final response.";
  const work = summaries.length > 0 ? ` Before stopping: ${summaries.join(" ")}` : "";
  const next = options.reachedStepLimit
    ? ""
    : " Try rephrasing the request or narrowing it to a specific board or ticket.";
  return `${cause}${work}${next}`;
}

export function hasVisibleCompletion(chunks: readonly string[]) {
  return chunks.some((chunk) => chunk.trim().length > 0);
}
