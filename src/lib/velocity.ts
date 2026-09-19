import { taskStaleness, type StalenessThresholds } from "./staleness";
import { isDoneByName, isDoneColumn } from "./doneColumns";

export interface VelocityRange {
  key: string;
  days: number;
  label: string;
  periodLabel: string;
  start?: string;
  end?: string;
}

export const VELOCITY_RANGES: readonly VelocityRange[] = [
  { key: "today", days: 1, label: "Today", periodLabel: "today" },
  {
    key: "yesterday",
    days: 1,
    label: "Yesterday",
    periodLabel: "yesterday",
  },
  { key: "7d", days: 7, label: "Last 7 days", periodLabel: "the last 7 days" },
  {
    key: "custom",
    days: 7,
    label: "Custom range",
    periodLabel: "the selected dates",
  },
];

export const DEFAULT_VELOCITY_RANGE_KEY = "7d";
const DAY_IN_MS = 86_400_000;
const WEEK_IN_MS = 7 * DAY_IN_MS;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function utcDayBoundary(value: string, end = false): Date | null {
  if (!DATE_KEY.test(value)) return null;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

export function resolveVelocityRange(
  key: string | null | undefined,
  from?: string | null,
  to?: string | null,
  now = new Date()
): VelocityRange {
  if (key === "yesterday") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
    );
    const end = new Date(start.getTime() + DAY_IN_MS - 1);
    return {
      ...VELOCITY_RANGES.find((range) => range.key === "yesterday")!,
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  if (key === "custom" && from && to) {
    const start = utcDayBoundary(from);
    const requestedEnd = utcDayBoundary(to, true);
    if (start && requestedEnd && start <= requestedEnd && start <= now) {
      const end = new Date(Math.min(requestedEnd.getTime(), now.getTime()));
      const days = Math.min(
        365,
        Math.floor((end.getTime() - start.getTime()) / DAY_IN_MS) + 1
      );
      const cappedEnd = new Date(
        Math.min(end.getTime(), start.getTime() + days * DAY_IN_MS - 1)
      );
      return {
        key: "custom",
        days,
        label: "Custom range",
        periodLabel: "the selected dates",
        start: start.toISOString(),
        end: cappedEnd.toISOString(),
      };
    }
  }

  return (
    VELOCITY_RANGES.find(
      (range) => range.key === key && range.key !== "custom"
    ) ??
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
    completedPerWeek: number | null;
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
  workedOn: {
    id: number;
    ticketNumber: string;
    title: string;
    href: string;
    activities: string[];
    lastActivityAt: string;
    mergedPullRequests: { title: string; url: string }[];
  }[];
}

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
  windowEnd: Date;
  priorStart: Date;
} {
  const explicitStart = toDate(range.start);
  const explicitEnd = toDate(range.end);
  const windowEnd =
    explicitEnd && explicitEnd < now ? explicitEnd : new Date(now.getTime());
  let granularity: VelocityGranularity;
  let bucketStarts: Date[];

  if (range.days === 1) {
    granularity = "hour";
    const dayStart =
      explicitStart ??
      new Date(
        Date.UTC(
          windowEnd.getUTCFullYear(),
          windowEnd.getUTCMonth(),
          windowEnd.getUTCDate()
        )
      );
    const bucketCount = Math.max(
      1,
      Math.floor((windowEnd.getTime() - dayStart.getTime()) / 3_600_000) + 1
    );
    bucketStarts = Array.from(
      { length: bucketCount },
      (_, index) => new Date(dayStart.getTime() + index * 3_600_000)
    );
  } else if (range.days <= 30) {
    granularity = "day";
    const firstDay =
      explicitStart ??
      new Date(
        Date.UTC(
          windowEnd.getUTCFullYear(),
          windowEnd.getUTCMonth(),
          windowEnd.getUTCDate() - (range.days - 1)
        )
      );
    bucketStarts = Array.from(
      { length: range.days },
      (_, index) => new Date(firstDay.getTime() + index * DAY_IN_MS)
    );
  } else {
    granularity = "week";
    const bucketCount = Math.ceil(range.days / 7);
    const firstWeek =
      explicitStart ??
      new Date(
        startOfWeekUTC(windowEnd).getTime() -
          (bucketCount - 1) * WEEK_IN_MS
      );
    bucketStarts = Array.from(
      { length: bucketCount },
      (_, index) => new Date(firstWeek.getTime() + index * WEEK_IN_MS)
    );
  }

  const windowStart = explicitStart ?? bucketStarts[0];
  const windowDuration = windowEnd.getTime() - windowStart.getTime() + 1;
  const priorStart = new Date(windowStart.getTime() - windowDuration);

  return { granularity, bucketStarts, windowStart, windowEnd, priorStart };
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
  workedOn: VelocityReport["workedOn"] = []
): VelocityReport {
  const { granularity, bucketStarts, windowStart, windowEnd, priorStart } =
    velocityWindow(now, range);
  const nowTime = now.getTime();
  const windowStartTime = windowStart.getTime();
  const windowEndTime = windowEnd.getTime();
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
      date.getTime() > windowEndTime
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
    if (!completed || completed.getTime() > windowEndTime) return;

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
      completed.getTime() <= windowEndTime
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
      created.getTime() > windowEndTime
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
  const windowDays = range.days;

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
      completedPerWeek:
        windowDays < 1 ? null : (completedInRange / windowDays) * 7,
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
    workedOn,
  };
}

export function velocityVerdict(report: VelocityReport): string {
  const current = report.speed.medianLeadTimeDays;
  const prior = report.speed.priorMedianLeadTimeDays;
  let previousPeriod = report.range.periodLabel.replace(
    /^the last /,
    "the previous "
  );
  if (report.range.key === "today") previousPeriod = "the period before today";
  if (report.range.key === "yesterday") previousPeriod = "the day before";
  if (report.range.key === "custom") previousPeriod = "the previous period";
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
