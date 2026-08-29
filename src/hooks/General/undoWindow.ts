// Decides whether a pending undo may still run, per trigger.
//
// HTPR-5528: the UNDO button on the archive toast stopped working while it was
// still on screen. react-hot-toast pauses a toast's auto-dismiss for as long as
// the pointer sits on it, so the prompt regularly outlives the 15s action
// window; the click was then dropped without an API call and without an error,
// leaving the task archived. A control the person can still see must still do
// its job, so the window bounds only the ambient Ctrl+Z path, which offers no
// affordance to judge.

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
