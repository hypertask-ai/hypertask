export const getInclusiveRange = <T>(
  items: readonly T[],
  anchor: T,
  target: T,
): T[] => {
  const anchorIndex = items.indexOf(anchor);
  const targetIndex = items.indexOf(target);

  if (anchorIndex === -1 || targetIndex === -1) return [target];

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return items.slice(start, end + 1);
};

export const toggleId = (
  ids: ReadonlySet<number>,
  id: number,
): Set<number> => {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export const getTaskIdsByGroup = <T extends { id: number }>(
  items: readonly T[],
  getGroupId: (item: T) => string | number | null | undefined,
): Map<string | number, number[]> => {
  const result = new Map<string | number, number[]>();
  for (const item of items) {
    const groupId = getGroupId(item);
    if (groupId == null) continue;
    const ids = result.get(groupId) ?? [];
    ids.push(item.id);
    result.set(groupId, ids);
  }
  return result;
};

export const toggleVisibleIds = (
  ids: ReadonlySet<number>,
  visibleIds: readonly number[],
): Set<number> => {
  const next = new Set(ids);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
  visibleIds.forEach((id) =>
    allVisibleSelected ? next.delete(id) : next.add(id),
  );
  return next;
};

export const getSharedProjectId = <T extends { projectId?: number | null }>(
  items: readonly T[],
): number | null => {
  if (items.length === 0 || items[0].projectId == null) return null;
  const projectId = items[0].projectId;
  return items.every((item) => item.projectId === projectId) ? projectId : null;
};
