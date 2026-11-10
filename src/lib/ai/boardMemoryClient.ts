import { boardMemoryRoute } from "@/lib/constants/APIRouteConstants";
import type { TAiMode } from "@/models/AI_Task_writer_model/AiTaskWriter.models";
import type { IForm } from "@/models/CreateTaskModalModels/model";

export const TASK_WRITER_NOTE_MAX_LENGTH = 2_000;

export type TaskWriterFieldSnapshot = {
  title?: string | null;
  priority?: string | null;
  estimate?: string | null;
  labels?: string[];
  status?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
};

export type TaskWriterSnapshotSource = Partial<
  Pick<IForm, "priority" | "estimate" | "tags" | "status" | "dueDate" | "startDate">
> & { title?: string | null };

export type BoardMemoryClientSignal =
  | {
      type: "task_writer_correction";
      originalText: string;
      correctionText: string;
    }
  | {
      type: "edited_ai_title";
      originalText: string;
      correctedText: string;
    }
  | {
      type: "task_writer_field_diff";
      note: string;
      draft: TaskWriterFieldSnapshot;
      saved: TaskWriterFieldSnapshot;
    };

const BOARD_MEMORY_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const BOARD_MEMORY_MAX_ATTEMPTS = 6;
const BOARD_MEMORY_MAX_RETRY_DELAY_SECONDS = 60;

type BoardMemoryClientDependencies = {
  fetcher?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
};

export function shouldLearnBoardMemoryFromAiMode(aiMode: TAiMode) {
  return aiMode === "AiTaskWriter";
}

export function shouldLearnBoardMemoryFromEditedTitle(
  originalTitle: string | null | undefined,
  savedTitle: string | null | undefined,
) {
  const original = originalTitle?.trim();
  const saved = savedTitle?.trim();
  return Boolean(original && saved && original !== saved);
}

export function createAiTitleEditTracker() {
  let originalTitle: string | null = null;

  return {
    record(title: string) {
      originalTitle = title.trim() || null;
    },
    reset() {
      originalTitle = null;
    },
    takeSignal(savedTitle: string): BoardMemoryClientSignal | null {
      const original = originalTitle;
      const saved = savedTitle.trim();
      originalTitle = null;
      if (
        !original ||
        !shouldLearnBoardMemoryFromEditedTitle(original, saved)
      ) {
        return null;
      }
      return {
        type: "edited_ai_title",
        originalText: original,
        correctedText: saved,
      };
    },
  };
}

function snapshotDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function snapshotTaskWriterFields(
  source: TaskWriterSnapshotSource,
): Required<TaskWriterFieldSnapshot> {
  return {
    title: source.title?.trim() || null,
    priority: source.priority?.Priority_Value ?? null,
    estimate: source.estimate?.estimate_full_value ?? null,
    labels: (source.tags ?? []).map((tag) => tag.value).sort(),
    status: source.status?.sectionTitle ?? null,
    dueDate: snapshotDate(source.dueDate),
    startDate: snapshotDate(source.startDate),
  };
}

export function diffTaskWriterFields(
  draft: Required<TaskWriterFieldSnapshot>,
  saved: Required<TaskWriterFieldSnapshot>,
) {
  const draftChanges: TaskWriterFieldSnapshot = {};
  const savedChanges: TaskWriterFieldSnapshot = {};
  for (const key of Object.keys(draft) as (keyof typeof draft)[]) {
    if (JSON.stringify(draft[key]) === JSON.stringify(saved[key])) continue;
    Object.assign(draftChanges, { [key]: draft[key] });
    Object.assign(savedChanges, { [key]: saved[key] });
  }
  return { draft: draftChanges, saved: savedChanges };
}

export function createTaskWriterFieldDiffTracker() {
  let pending: {
    note: string;
    draft: Required<TaskWriterFieldSnapshot>;
  } | null = null;

  return {
    record(note: string, draft: TaskWriterSnapshotSource) {
      const trimmed = note.trim().slice(0, TASK_WRITER_NOTE_MAX_LENGTH);
      pending = trimmed
        ? { note: trimmed, draft: snapshotTaskWriterFields(draft) }
        : null;
    },
    reset() {
      pending = null;
    },
    takeSignal(saved: TaskWriterSnapshotSource): BoardMemoryClientSignal | null {
      const current = pending;
      pending = null;
      if (!current) return null;
      const diff = diffTaskWriterFields(
        current.draft,
        snapshotTaskWriterFields(saved),
      );
      if (Object.keys(diff.saved).length === 0) return null;
      return { type: "task_writer_field_diff", note: current.note, ...diff };
    },
  };
}

export async function recordBoardMemorySignal(
  projectId: number | null | undefined,
  signal: BoardMemoryClientSignal,
  dependencies: BoardMemoryClientDependencies = {},
) {
  if (!Number.isInteger(projectId) || !projectId) return;

  const fetcher = dependencies.fetcher ?? fetch;
  const wait =
    dependencies.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < BOARD_MEMORY_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(boardMemoryRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...signal }),
        keepalive: true,
      });
    } catch {
      if (attempt + 1 >= BOARD_MEMORY_MAX_ATTEMPTS) return;
      await wait(Math.min(2 ** attempt, 30) * 1000);
      continue;
    }
    if (
      response.ok ||
      !BOARD_MEMORY_RETRYABLE_STATUSES.has(response.status)
    ) {
      return;
    }
    if (attempt + 1 >= BOARD_MEMORY_MAX_ATTEMPTS) return;

    const retryAfterSeconds = Number(response.headers.get("Retry-After"));
    const fallbackSeconds = Math.min(2 ** attempt, 30);
    const delaySeconds =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds, BOARD_MEMORY_MAX_RETRY_DELAY_SECONDS)
        : fallbackSeconds;
    await wait(delaySeconds * 1000);
  }
}
