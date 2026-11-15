export const LATEST_UPDATES_REACH_DAYS = 7;

export type DatedPost = { createdAt: string };

export type DayGroup<T extends DatedPost> = { key: string; label: string; posts: T[] };

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function dayLabel(date: Date, now: Date): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(new Date(now.getTime() - DAY_MS))) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function latestUpdatesDayGroups<T extends DatedPost>(
  posts: readonly T[],
  now: Date,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const post of posts) {
    const date = new Date(post.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.posts.push(post);
      continue;
    }
    groups.push({ key, label: dayLabel(date, now), posts: [post] });
  }
  return groups;
}

export function digestRunLabel(iso: string | null | undefined, now: Date): string {
  if (!iso) return "Notes job has not run yet";
  const run = new Date(iso);
  if (Number.isNaN(run.getTime())) return "Notes job run time is unknown";
  const day = dayLabel(run, now);
  const time = run.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `Notes last ran ${day === "Today" || day === "Yesterday" ? day.toLowerCase() : `on ${day}`} at ${time}`;
}
