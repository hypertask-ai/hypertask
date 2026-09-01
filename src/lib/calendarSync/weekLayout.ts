import type { ITask } from "@/models/model";

export type WeekTaskBar = {
  task: ITask;
  startDate: Date;
  dueDate: Date;
  startColumn: number;
  endColumn: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

const localDay = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

export const buildWeekTaskBars = (
  visibleDays: Date[],
  tasks: ITask[],
): WeekTaskBar[] => {
  const days = visibleDays.map(localDay).filter(Boolean) as Date[];
  if (days.length === 0) return [];

  const firstVisible = days[0].getTime();
  const lastVisible = days[days.length - 1].getTime();
  const seen = new Set<number>();
  const candidates: Omit<WeekTaskBar, "lane">[] = [];

  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);

    const startDate = localDay(task.startDate);
    const dueDate = localDay(task.dueDate);
    if (!startDate || !dueDate || startDate.getTime() >= dueDate.getTime()) {
      continue;
    }

    const startColumn = days.findIndex(
      (day) => day.getTime() >= startDate.getTime(),
    );
    let endColumn = -1;
    for (let index = days.length - 1; index >= 0; index -= 1) {
      if (days[index].getTime() <= dueDate.getTime()) {
        endColumn = index;
        break;
      }
    }
    if (
      startColumn === -1 ||
      endColumn === -1 ||
      startColumn > endColumn ||
      dueDate.getTime() < firstVisible ||
      startDate.getTime() > lastVisible
    ) {
      continue;
    }

    candidates.push({
      task,
      startDate,
      dueDate,
      startColumn,
      endColumn,
      continuesBefore: startDate.getTime() < firstVisible,
      continuesAfter: dueDate.getTime() > lastVisible,
    });
  }

  candidates.sort(
    (left, right) =>
      left.startColumn - right.startColumn ||
      right.endColumn - left.endColumn ||
      left.task.id - right.task.id,
  );

  const laneEnds: number[] = [];
  return candidates.map((candidate) => {
    let lane = laneEnds.findIndex((endColumn) => endColumn < candidate.startColumn);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = candidate.endColumn;
    return { ...candidate, lane };
  });
};
