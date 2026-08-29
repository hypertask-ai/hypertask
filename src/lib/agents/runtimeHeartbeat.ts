import type {
  AgentRuntimeQueueItem,
  AgentRuntimeSaveResult,
  AgentRuntimeSnapshot,
} from "@/lib/agents/runtimeState";
import type { Prisma, PrismaClient } from "@prisma/client";

export type RuntimeHeartbeatDatabase = Pick<PrismaClient, "agent" | "task">;

export class RuntimeHeartbeatError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly resetSequence?: number,
  ) {
    super(message);
  }
}

type QueueCandidate = {
  boardId: number;
  ticket: string;
  state: AgentRuntimeQueueItem["state"];
  reason: AgentRuntimeQueueItem["reason"];
  startedAt: string | null;
};

const cleanText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const cleanInstant = (
  value: unknown,
  now: Date,
): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(Math.min(parsed.getTime(), now.getTime())).toISOString();
};

const containsCredentialShape = (value: string) =>
  /(?:bearer|secret|token|api[_ -]?key|ht[mk]?k_|sk-(?:ant-|proj-)?|gh[pousr]_|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{12,}\.)/i.test(
    value,
  );

const safeRuntimeLabel = (value: unknown, fallback: string, max: number) => {
  const label = cleanText(value, max);
  if (!label || containsCredentialShape(label)) {
    return fallback;
  }
  return label;
};

function queueCandidate(
  value: unknown,
  visibleBoardIds: ReadonlySet<number>,
  now: Date,
): QueueCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const boardId = Number(row.board_id);
  const ticket = cleanText(row.ticket, 40).toUpperCase();
  if (
    !Number.isInteger(boardId) ||
    !visibleBoardIds.has(boardId) ||
    !/^[A-Z][A-Z0-9]*-\d+$/.test(ticket)
  ) {
    return null;
  }
  const state = ["running", "waiting"].includes(String(row.state))
    ? (row.state as QueueCandidate["state"])
    : "pending";
  const reason = ["direct_mention", "assignment", "discovery"].includes(
    String(row.reason),
  )
    ? (row.reason as QueueCandidate["reason"])
    : "other";
  return {
    boardId,
    ticket,
    state,
    reason,
    startedAt:
      state === "pending" ? null : cleanInstant(row.started_at, now),
  };
}

export async function acceptAgentRuntimeHeartbeat(input: {
  agentId: string;
  userId: number;
  authenticatedGeneration: number;
  projectWhere: Prisma.ProjectWhereInput;
  body: Record<string, unknown>;
  now?: Date;
  db: RuntimeHeartbeatDatabase;
  save: (
    agentId: string,
    generation: number,
    snapshot: AgentRuntimeSnapshot,
  ) => Promise<AgentRuntimeSaveResult>;
}): Promise<AgentRuntimeSnapshot> {
  const now = input.now ?? new Date();
  const agent = await input.db.agent.findFirst({
    where: {
      id: input.agentId,
      userId: input.userId,
      revokedAt: null,
      runtimeGeneration: input.authenticatedGeneration,
    },
    select: {
      id: true,
      members: {
        where: {
          status: "Accepted",
          project: { status: "Normal", ...input.projectWhere },
        },
        select: { projectId: true },
      },
    },
  });
  if (!agent) throw new RuntimeHeartbeatError("Agent does not exist", 404);

  const visibleBoardIds = new Set(agent.members.map((member) => member.projectId));
  const rawQueue = Array.isArray(input.body.queue)
    ? input.body.queue.slice(0, 50)
    : [];
  const seenQueue = new Set<string>();
  const candidates = rawQueue
    .map((item) => queueCandidate(item, visibleBoardIds, now))
    .filter((item): item is QueueCandidate => {
      if (!item) return false;
      const key = `${item.boardId}:${item.ticket}`;
      if (seenQueue.has(key)) return false;
      seenQueue.add(key);
      return true;
    });
  const processedCandidates = Array.isArray(input.body.processed_tickets)
    ? input.body.processed_tickets
        .slice(0, 50)
        .map((item) => queueCandidate(item, visibleBoardIds, now))
        .filter((item): item is QueueCandidate => Boolean(item))
    : [];
  const taskReferences = [...candidates, ...processedCandidates];
  const tasks = taskReferences.length
    ? await input.db.task.findMany({
        where: {
          status: "Normal",
          archivedAt: null,
          deletedAt: null,
          project: input.projectWhere,
          OR: taskReferences.map(({ boardId, ticket }) => ({
            projectId: boardId,
            ticketNumber: ticket,
          })),
        },
        select: {
          projectId: true,
          uniqueIndex: true,
          ticketNumber: true,
          title: true,
          section: true,
          dueDate: true,
          project: { select: { name: true, title: true } },
          priority: { select: { Priority_Value: true } },
        },
      })
    : [];
  const tasksByKey = new Map(
    tasks.map((task) => [`${task.projectId}:${task.ticketNumber}`, task]),
  );
  let hasActive = false;
  const queue = candidates.flatMap((candidate): AgentRuntimeQueueItem[] => {
    const task = tasksByKey.get(`${candidate.boardId}:${candidate.ticket}`);
    if (!task) return [];
    const requestedActive = candidate.state !== "pending";
    const state = requestedActive && !hasActive ? candidate.state : "pending";
    if (state !== "pending") hasActive = true;
    return [
      {
        ticket: task.ticketNumber ?? candidate.ticket,
        title: task.title,
        url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
        boardId: task.projectId,
        boardName: task.project.title ?? task.project.name,
        section: task.section,
        state,
        reason: candidate.reason,
        priority: task.priority?.Priority_Value ?? null,
        dueAt: task.dueDate?.toISOString() ?? null,
        startedAt: state === "pending" ? null : candidate.startedAt,
      },
    ];
  });
  const seenSourceSections = new Set<string>();
  const sourceSections = Array.isArray(input.body.source_sections)
    ? input.body.source_sections.slice(0, 20).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const boardId = Number(row.board_id);
        const section = cleanText(row.section, 255);
        const key = `${boardId}:${section}`;
        if (
          !Number.isInteger(boardId) ||
          !visibleBoardIds.has(boardId) ||
          !section ||
          containsCredentialShape(section) ||
          seenSourceSections.has(key)
        ) {
          return [];
        }
        seenSourceSections.add(key);
        return [{ boardId, section }];
      })
    : [];
  const scopeLabel = cleanText(input.body.scope_label, 255);
  const seenProcessed = new Set<string>();
  const processedTickets = processedCandidates.flatMap(({ boardId, ticket }) => {
    const key = `${boardId}:${ticket}`;
    if (!tasksByKey.has(key) || seenProcessed.has(key)) return [];
    seenProcessed.add(key);
    return [{ boardId, ticket }];
  });
  const cadenceSeconds = Math.min(
    3600,
    Math.max(10, Math.trunc(Number(input.body.cadence_seconds) || 30)),
  );
  const sequence = Math.trunc(Number(input.body.sequence));
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RuntimeHeartbeatError("A positive runtime sequence is required", 400);
  }
  const snapshot: AgentRuntimeSnapshot = {
    version: 1,
    sequence,
    workerId: safeRuntimeLabel(input.body.worker_id, agent.id, 120),
    runtime: safeRuntimeLabel(input.body.runtime, "external", 80),
    model: cleanText(input.body.model, 160)
      ? safeRuntimeLabel(input.body.model, "Unreported", 160)
      : null,
    heartbeatAt: now.toISOString(),
    lastProgressAt: cleanInstant(input.body.last_progress_at, now),
    cadenceSeconds,
    sourceSections,
    scopeLabel: scopeLabel && !containsCredentialShape(scopeLabel)
      ? scopeLabel
      : null,
    processedTickets,
    queue,
  };
  const saveResult = await input.save(
    agent.id,
    input.authenticatedGeneration,
    snapshot,
  );
  if (saveResult.status !== "saved") {
    throw new RuntimeHeartbeatError(
      "Runtime sequence must be resynchronized",
      409,
      saveResult.nextSequence,
    );
  }
  return snapshot;
}
