import type { InboxQueryPayload } from "@/utils/helperFunctions/helperFunctions";

export const canWarmPreviousBoardFromInbox = (
  payload: InboxQueryPayload | undefined,
): boolean =>
  payload?.dataOrigin != null && payload.dataOrigin !== "placeholder";
