export function initialTicketPosition({
  hasDeepLink,
  scrollSetting,
  fromInbox,
  lastReadAt,
  firstUnreadCommentId,
}: {
  hasDeepLink: boolean;
  scrollSetting: string;
  fromInbox: boolean;
  lastReadAt: string | Date | null | undefined;
  firstUnreadCommentId?: number;
}): "deepLink" | "top" | "firstUnread" | "bottom" {
  if (hasDeepLink) return "deepLink";
  if (fromInbox ? scrollSetting === "None" : scrollSetting !== "Bottom") return "top";
  if (lastReadAt == null) return "top";
  if (firstUnreadCommentId != null) return "firstUnread";
  return "bottom";
}
