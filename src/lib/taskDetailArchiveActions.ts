export type TaskDetailHeaderAction =
  | "share"
  | "remove-notification"
  | "archive"
  | "remind"
  | "command";

export function getTaskDetailHeaderActions({
  hasNotifications,
  isMobile,
}: {
  hasNotifications: boolean;
  isMobile: boolean;
}): TaskDetailHeaderAction[] {
  if (isMobile) return ["share", "archive"];

  return [
    "share",
    ...(hasNotifications ? (["remove-notification"] as const) : []),
    "archive",
    "remind",
    "command",
  ];
}
