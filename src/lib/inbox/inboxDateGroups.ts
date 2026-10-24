import type { FirstScreenSnapshot } from "@/lib/firstScreen/SurfaceContext";
import { projectInboxDateGroup } from "@/lib/firstScreen/inbox";
import { inboxConfig } from "@/lib/configs/inbox.config";

const getDateGroup = (date: Date): string => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const notificationDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const daysDiff = Math.floor(
    (today.getTime() - notificationDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysDiff === 0) return "today";
  if (daysDiff === 1) return "yesterday";

  const currentWeekStart = new Date(today);
  const dayOfWeek = today.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  currentWeekStart.setDate(today.getDate() - daysToMonday);

  const lastWeekStart = new Date(currentWeekStart);
  lastWeekStart.setDate(currentWeekStart.getDate() - 7);

  const lastWeekEnd = new Date(currentWeekStart);
  lastWeekEnd.setDate(currentWeekStart.getDate() - 1);

  if (notificationDate >= currentWeekStart && notificationDate < yesterday) {
    return "thisWeek";
  }

  if (notificationDate >= lastWeekStart && notificationDate <= lastWeekEnd) {
    return "lastWeek";
  }

  return `${date.getMonth()}-${date.getFullYear()}`;
};

const getDateGroupLabel = (group: string): string => {
  if (
    inboxConfig.dateGrouping.labels[
      group as keyof typeof inboxConfig.dateGrouping.labels
    ]
  ) {
    return inboxConfig.dateGrouping.labels[
      group as keyof typeof inboxConfig.dateGrouping.labels
    ];
  }

  const monthYearMatch = group.match(/^(\d+)-(\d+)$/);
  if (monthYearMatch) {
    const monthIndex = parseInt(monthYearMatch[1]);
    const year = monthYearMatch[2];
    return `${inboxConfig.dateGrouping.monthNames[monthIndex]}, ${year}`;
  }

  return group;
};

export const groupInboxItemsByDate = <T extends { date: Date }>(
  items: T[],
  oldestFirst = false,
  snapshot?: FirstScreenSnapshot | null,
): Record<string, { label: string; items: T[] }> => {
  const groups: Record<string, { label: string; items: T[] }> = {};

  const groupedByDate: Record<string, T[]> = {};

  items.forEach((item) => {
    const group = snapshot ? projectInboxDateGroup(item.date.toISOString(), snapshot.now, snapshot.display.timeZone) : getDateGroup(item.date);

    if (!groupedByDate[group]) {
      groupedByDate[group] = [];
    }
    groupedByDate[group].push(item);
  });

  Object.values(groupedByDate).forEach((groupItems) => {
    groupItems.sort((left, right) =>
      oldestFirst
        ? left.date.getTime() - right.date.getTime()
        : right.date.getTime() - left.date.getTime(),
    );
  });

  const monthYearGroups: string[] = [];

  Object.keys(groupedByDate).forEach((key) => {
    if (!inboxConfig.dateGrouping.order.includes(key)) {
      monthYearGroups.push(key);
    }
  });

  monthYearGroups.sort((a, b) => {
    const [monthA, yearA] = a.split("-").map(Number);
    const [monthB, yearB] = b.split("-").map(Number);

    if (yearA !== yearB) {
      return oldestFirst ? yearA - yearB : yearB - yearA;
    }
    return oldestFirst ? monthA - monthB : monthB - monthA;
  });

  const predefinedOrder = oldestFirst
    ? [...inboxConfig.dateGrouping.order].reverse()
    : inboxConfig.dateGrouping.order;
  predefinedOrder.forEach((groupKey) => {
    if (groupedByDate[groupKey] && groupedByDate[groupKey].length > 0) {
      groups[groupKey] = {
        label: getDateGroupLabel(groupKey),
        items: groupedByDate[groupKey],
      };
    }
  });

  monthYearGroups.forEach((groupKey) => {
    if (groupedByDate[groupKey] && groupedByDate[groupKey].length > 0) {
      groups[groupKey] = {
        label: getDateGroupLabel(groupKey),
        items: groupedByDate[groupKey],
      };
    }
  });

  return groups;
};
