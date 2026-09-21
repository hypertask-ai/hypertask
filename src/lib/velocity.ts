import { taskStaleness, type StalenessThresholds } from "./staleness";
import { isDoneByName, isDoneColumn } from "./doneColumns";

export interface VelocityRange {
  key: string;
  days: number;
  label: string;
  periodLabel: string;
}

export const VELOCITY_RANGES: readonly VelocityRange[] = [
  { key: "1d", days: 1, label: "Today", periodLabel: "today" },
  { key: "7d", days: 7, label: "7 days", periodLabel: "the last 7 days" },
  { key: "14d", days: 14, label: "14 days", periodLabel: "the last 14 days" },
  { key: "30d", days: 30, label: "30 days", periodLabel: "the last 30 days" },
  { key: "3m", days: 90, label: "3 months", periodLabel: "the last 3 months" },
  { key: "6m", days: 180, label: "6 months", periodLabel: "the last 6 months" },
  { key: "12m", days: 365, label: "12 months", periodLabel: "the last 12 months" },
];

export const DEFAULT_VELOCITY_RANGE_KEY = "30d";

export function resolveVelocityRange(
  key: string | null | undefined
): VelocityRange {
  return (
    VELOCITY_RANGES.find((range) => range.key === key) ??
    VELOCITY_RANGES.find(
      (range) => range.key === DEFAULT_VELOCITY_RANGE_KEY
    )!
  );
}

export type VelocityGranularity = "hour" | "day" | "week" | "month";

export function isDoneSection(
  section: string | null | undefined,
  doneTitles?: ReadonlySet<string> | null
): boolean {
  return isDoneColumn(section, doneTitles, isDoneByName);
}

export interface VelocityTaskRow {
  id: number;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  sectionChangedAt?: Date | string | null;
  lastCommentAt?: Date | string | null;
  section: string;
  status: string;
  assigneeUserIds: number[];
}

export interface VelocityCommentRow {
  userId: number;
  comments: number;
  lastCommentAt: Date | string | null;
}

export interface VelocityReport {
  generatedAt: string;
  range: VelocityRange;
  granularity: VelocityGranularity;
  buckets: {
    start: string;
    created: number;
    completed: number;
  }[];
  totals: {
    created: number;
    completed: number;
    net: number;
  };
  speed: {
    medianLeadTimeDays: number | null;
    priorMedianLeadTimeDays: number | null;
    completedInRange: number;
    priorCompletedInRange: number;
    completedPerDay: number | null;
    oldestOpenDays: number | null;
  };
  now: {
    openTotal: number;
    staleTotal: number;
    columns: {
      section: string;
      open: number;
      stale: number;
    }[];
  };
  people: {
    userId: number;
    displayName: string;
    completed: number;
    comments: number;
    lastActiveAt: string | null;
  }[];
}

const DAY_IN_MS = 86_400_000;
const WEEK_IN_MS = 7 * DAY_IN_MS;

const toDate = (
  value: Date | string | null | undefined
): Date | null => {
  if (value === null || value === undefined) return null;

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfWeekUTC = (date: Date): Date => {
  const weekStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);
  return weekStart;
};

export function velocityWindow(
  now: Date,
  range: VelocityRange
): {
  granularity: VelocityGranularity;
  bucketStarts: Date[];
  windowStart: Date;
  priorStart: Date;
} {
  let granularity: VelocityGranularity;
  let bucketStarts: Date[];

  if (range.days === 1) {
    granularity = "hour";
    bucketStarts = Array.from({ length: now.getUTCHours() + 1 }, (_, index) =>
      new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          index
        )
      )
    );
  } else if (range.days <= 30) {
    granularity = "day";
    bucketStarts = Array.from({ length: range.days }, (_, index) =>
      new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - (range.days - 1 - index)
        )
      )
    );
  } else if (range.days <= 180) {
    granularity = "week";
    const bucketCount = Math.ceil(range.days / 7);
    const currentWeekStart = startOfWeekUTC(now);
    bucketStarts = Array.from({ length: bucketCount }, (_, index) =>
      new Date(
        currentWeekStart.getTime() -
          (bucketCount - 1 - index) * WEEK_IN_MS
      )
    );
  } else {
    granularity = "month";
    bucketStarts = Array.from({ length: 12 }, (_, index) =>
      new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() - (11 - index),
          1
        )
      )
    );
  }

  const windowStart = bucketStarts[0];
  const priorStart = new Date(
    windowStart.getTime() - (now.getTime() - windowStart.getTime())
  );

  return { granularity, bucketStarts, windowStart, priorStart };
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
};

const wholeDaysSince = (date: Date, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_IN_MS));

/** When a task finished, or null if it is not finished.
 *  Done-like column -> sectionChangedAt (when it entered that column).
 *  Archived elsewhere -> updatedAt (the archive write). */
export function completedAt(
  task: VelocityTaskRow,
  doneTitles?: ReadonlySet<string>
): Date | null {
  if (isDoneSection(task.section, doneTitles)) {
    return toDate(task.sectionChangedAt ?? task.updatedAt ?? task.createdAt);
  }

  if (task.status === "Archive") {
    return toDate(task.updatedAt ?? task.createdAt);
  }

  return null;
}

// The report is computed from existing task timestamps at read time. Capturing
// now once keeps every bucket, age, and activity cutoff internally consistent.
export function buildVelocityReport(
  tasks: VelocityTaskRow[],
  comments: VelocityCommentRow[],
  members: { userId: number; displayName: string; email: string }[],
  now: Date,
  range: VelocityRange = resolveVelocityRange(DEFAULT_VELOCITY_RANGE_KEY),
  thresholds?: StalenessThresholds,
  doneTitles?: ReadonlySet<string>,
): VelocityReport {
  const { granularity, bucketStarts, windowStart, priorStart } =
    velocityWindow(now, range);
  const nowTime = now.getTime();
  const windowStartTime = windowStart.getTime();
  const priorStartTime = priorStart.getTime();
  const buckets = bucketStarts.map((start) => ({
    start: start.toISOString(),
    created: 0,
    completed: 0,
  }));

  const taskDates = tasks.map((task) => ({
    task,
    created: toDate(task.createdAt),
    completed: completedAt(task, doneTitles),
    sectionChanged: toDate(task.sectionChangedAt),
  }));

  const bucketIndex = (date: Date): number => {
    if (
      date.getTime() < windowStartTime ||
      date.getTime() > nowTime
    ) {
      return -1;
    }
    for (let index = bucketStarts.length - 1; index >= 0; index -= 1) {
      if (date.getTime() >= bucketStarts[index].getTime()) return index;
    }
    return -1;
  };

  taskDates.forEach(({ created, completed }) => {
    if (created) {
      const createdIndex = bucketIndex(created);
      if (buckets[createdIndex]) buckets[createdIndex].created += 1;
    }
    if (completed) {
      const completedIndex = bucketIndex(completed);
      if (buckets[completedIndex]) buckets[completedIndex].completed += 1;
    }
  });

  const currentLeadTimes: number[] = [];
  const priorLeadTimes: number[] = [];
  let completedInRange = 0;
  let priorCompletedInRange = 0;

  taskDates.forEach(({ created, completed }) => {
    if (!completed || completed.getTime() > nowTime) return;

    if (completed.getTime() >= windowStartTime) {
      completedInRange += 1;
      if (created) {
        currentLeadTimes.push(
          Math.max(
            0,
            (completed.getTime() - created.getTime()) / DAY_IN_MS
          )
        );
      }
    } else if (completed.getTime() >= priorStartTime) {
      priorCompletedInRange += 1;
      if (created) {
        priorLeadTimes.push(
          Math.max(
            0,
            (completed.getTime() - created.getTime()) / DAY_IN_MS
          )
        );
      }
    }
  });

  const openTasks = taskDates.filter(({ completed }) => completed === null);
  const columnMap = new Map<string, { open: number; stale: number }>();
  let oldestOpenDays: number | null = null;
  let staleTotal = 0;

  openTasks.forEach(({ task, created }) => {
    const column = columnMap.get(task.section) ?? { open: 0, stale: 0 };
    column.open += 1;

    if (
      taskStaleness({
        createdAt: task.createdAt,
        sectionChangedAt: task.sectionChangedAt,
        lastCommentAt: task.lastCommentAt,
      }, thresholds).level !== "none"
    ) {
      column.stale += 1;
      staleTotal += 1;
    }
    columnMap.set(task.section, column);

    if (created) {
      const openDays = wholeDaysSince(created, now);
      oldestOpenDays =
        oldestOpenDays === null ? openDays : Math.max(oldestOpenDays, openDays);
    }
  });

  const memberActivity = new Map(
    members.map((member) => [
      member.userId,
      {
        userId: member.userId,
        displayName: member.displayName || member.email,
        completed: 0,
        comments: 0,
        lastActiveAt: null as Date | null,
      },
    ])
  );

  const updateLastActive = (userId: number, date: Date | null) => {
    const activity = memberActivity.get(userId);
    if (!activity || !date || date.getTime() > nowTime) return;
    if (!activity.lastActiveAt || date > activity.lastActiveAt) {
      activity.lastActiveAt = date;
    }
  };

  // Only completions and comments are attributed per person. `updatedByUserIds`
  // is append-only with no per-user timestamp, so crediting an edit to everyone
  // on that list would report people as active in a period they sat out.
  taskDates.forEach(({ task, completed }) => {
    if (
      completed &&
      completed.getTime() >= windowStartTime &&
      completed.getTime() <= nowTime
    ) {
      new Set(task.assigneeUserIds).forEach((userId) => {
        const activity = memberActivity.get(userId);
        if (activity) activity.completed += 1;
      });
    }
  });

  comments.forEach((comment) => {
    const created = toDate(comment.lastCommentAt);
    if (
      !created ||
      created.getTime() < windowStartTime ||
      created.getTime() > nowTime
    ) {
      return;
    }

    const activity = memberActivity.get(comment.userId);
    if (activity) activity.comments += comment.comments;
    updateLastActive(comment.userId, created);
  });

  const totals = buckets.reduce(
    (total, bucket) => ({
      created: total.created + bucket.created,
      completed: total.completed + bucket.completed,
      net: total.net + bucket.created - bucket.completed,
    }),
    { created: 0, completed: 0, net: 0 }
  );
  const windowDays = (nowTime - windowStartTime) / DAY_IN_MS;

  return {
    generatedAt: now.toISOString(),
    range,
    granularity,
    buckets,
    totals,
    speed: {
      medianLeadTimeDays: median(currentLeadTimes),
      priorMedianLeadTimeDays: median(priorLeadTimes),
      completedInRange,
      priorCompletedInRange,
      completedPerDay:
        windowDays < 1 ? null : completedInRange / windowDays,
      oldestOpenDays,
    },
    now: {
      openTotal: openTasks.length,
      staleTotal,
      columns: Array.from(columnMap, ([section, counts]) => ({
        section,
        ...counts,
      })).sort(
        (a, b) => b.open - a.open || (a.section < b.section ? -1 : 1)
      ),
    },
    people: Array.from(memberActivity.values())
      .map(({ lastActiveAt, ...activity }) => ({
        ...activity,
        lastActiveAt: lastActiveAt?.toISOString() ?? null,
      }))
      .sort(
        (a, b) =>
          b.completed - a.completed ||
          b.comments - a.comments ||
          a.userId - b.userId
      ),
  };
}

export function velocityVerdict(report: VelocityReport): string {
  const current = report.speed.medianLeadTimeDays;
  const prior = report.speed.priorMedianLeadTimeDays;
  const previousPeriod =
    report.range.periodLabel === "today"
      ? "the period before today"
      : report.range.periodLabel.replace(/^the last /, "the previous ");
  const pace =
    current === null || prior === null
      ? "Not enough finished work to compare periods"
      : current < prior
      ? `Finishing work faster than ${previousPeriod}`
      : current > prior
      ? `Finishing work slower than ${previousPeriod}`
      : "Holding steady";
  const backlog =
    report.totals.net < 0
      ? "backlog shrinking"
      : report.totals.net > 0
      ? "backlog growing"
      : "backlog stable";

  return `${pace} · ${backlog}`;
}
