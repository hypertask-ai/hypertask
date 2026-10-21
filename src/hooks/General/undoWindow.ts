
export type UndoTrigger = "toast" | "shortcut";

export type PendingUndo = { expiresAt: number } | null | undefined;

export function isUndoWindowExpired(pending: PendingUndo, now: number) {
  return !pending || pending.expiresAt <= now;
}

export function canRunUndo(
  pending: PendingUndo,
  trigger: UndoTrigger,
  now: number,
) {
  if (!pending) return false;
  if (trigger === "toast") return true;
  return !isUndoWindowExpired(pending, now);
}
