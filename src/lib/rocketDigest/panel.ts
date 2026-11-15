export const LATEST_UPDATES_REACH_DAYS = 7;

export type DatedPost = { createdAt: string };

export type DayGroup<T extends DatedPost> = { key: string; label: string; posts: T[] };

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function previousDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

export function dayLabel(date: Date, now: Date): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(previousDay(now))) return "Yesterday";
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
