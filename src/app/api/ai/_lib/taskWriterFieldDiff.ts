import { containsUnsafeBoardMemoryContent } from "@/app/api/ai/_lib/boardMemoryContract";
import {
  TASK_WRITER_NOTE_MAX_LENGTH,
  type BoardMemoryClientSignal,
  type TaskWriterFieldSnapshot,
} from "@/lib/ai/boardMemoryClient";

type TaskWriterFieldDiffFields = TaskWriterFieldSnapshot;
export type TaskWriterFieldDiffSignal = Extract<
  BoardMemoryClientSignal,
  { type: "task_writer_field_diff" }
>;

function collectText(fields: TaskWriterFieldDiffFields) {
  return Object.values(fields).flatMap((value) =>
    Array.isArray(value) ? value : typeof value === "string" ? [value] : [],
  );
}

export function prepareTaskWriterFieldDiffSignal(
  signal: TaskWriterFieldDiffSignal,
): TaskWriterFieldDiffSignal | null {
  const note = signal.note.trim().slice(0, TASK_WRITER_NOTE_MAX_LENGTH);
  if (!note) return null;
  const texts = [note, ...collectText(signal.draft), ...collectText(signal.saved)];
  if (texts.some(containsUnsafeBoardMemoryContent)) return null;
  return { ...signal, note };
}
