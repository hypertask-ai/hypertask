export const BULK_MOVE_BOARD_LIMIT = 500;

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

export const MOUSE_MULTISELECT_HINT_KEY = "htpr-8976-mouse-multiselect-hint";

export const mouseMultiselectHintSeen = (): boolean => {
  try {
    return window.localStorage.getItem(MOUSE_MULTISELECT_HINT_KEY) === "seen";
  } catch {
    return true;
  }
};

export const markMouseMultiselectHintSeen = (): void => {
  try {
    window.localStorage.setItem(MOUSE_MULTISELECT_HINT_KEY, "seen");
  } catch {
  }
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
