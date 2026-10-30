const OWN_NOTE = "You own this task, so you already get its updates";
const ASSIGNEE_NOTE = "You already get this task's updates as an assignee";
const ALREADY_FOLLOWING_NOTE = "You already follow this task";
const FAILED_NOTE = "Could not follow this task";

export function followNote(payload: unknown): string {
  const text =
    typeof payload === "string"
      ? payload
      : typeof (payload as { message?: unknown })?.message === "string"
        ? (payload as { message: string }).message
        : "";
  if (/task owner/i.test(text)) return OWN_NOTE;
  if (/assignee/i.test(text)) return ASSIGNEE_NOTE;
  if (/already a follower/i.test(text)) return ALREADY_FOLLOWING_NOTE;
  return FAILED_NOTE;
}
