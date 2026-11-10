import { containsUnsafeBoardMemoryContent } from "@/app/api/ai/_lib/boardMemoryContract";
import {
  TASK_WRITER_NOTE_MAX_LENGTH,
  type BoardMemoryClientSignal,
  type TaskWriterFieldSnapshot,
} from "@/lib/ai/boardMemoryClient";
import { HTPR_9010_TASK_WRITER_MEMORY_FLAG } from "@/lib/flags/definitions/htpr-9010-task-writer-memory";

type TaskWriterFieldDiffFields = TaskWriterFieldSnapshot;
export type TaskWriterFieldDiffSignal = Extract<
  BoardMemoryClientSignal,
  { type: "task_writer_field_diff" }
>;

type FlagCheck = (userId: number) => Promise<boolean>;

async function readFlag(userId: number) {
  const { isFeatureEnabled } = await import("@/lib/flags");
  return isFeatureEnabled(HTPR_9010_TASK_WRITER_MEMORY_FLAG, userId);
}

function collectText(fields: TaskWriterFieldDiffFields) {
  return Object.values(fields).flatMap((value) =>
    Array.isArray(value) ? value : typeof value === "string" ? [value] : [],
  );
}

export async function prepareTaskWriterFieldDiffSignal(
  signal: TaskWriterFieldDiffSignal,
  userId: number,
  isEnabled: FlagCheck = readFlag,
): Promise<TaskWriterFieldDiffSignal | null> {
  if (!(await isEnabled(userId))) return null;
  const note = signal.note.trim().slice(0, TASK_WRITER_NOTE_MAX_LENGTH);
  if (!note) return null;
  const texts = [note, ...collectText(signal.draft), ...collectText(signal.saved)];
  if (texts.some(containsUnsafeBoardMemoryContent)) return null;
  return { ...signal, note };
}
