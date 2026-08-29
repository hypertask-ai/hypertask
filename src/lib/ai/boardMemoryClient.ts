import { boardMemoryRoute } from "@/lib/constants/APIRouteConstants";
import type { TAiMode } from "@/models/AI_Task_writer_model/AiTaskWriter.models";

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
