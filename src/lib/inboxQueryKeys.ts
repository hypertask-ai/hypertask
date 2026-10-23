export const INBOX_QUERY_KEY = ["inbox"] as const;
export const inboxDataQueryKey = (userId: number | null | undefined) =>
  [...INBOX_QUERY_KEY, "data", userId] as const;
export const inboxAccessQueryKey = (userId: number | null | undefined) =>
  [...INBOX_QUERY_KEY, "access", userId] as const;
