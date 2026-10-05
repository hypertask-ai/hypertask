import type { IUser } from "@/models/model";
import type { IUserDraft } from "@/hooks/General/useGetUserDrafts";
import type { DisplayAvatar } from "@prisma/client";
import type { InboxQueryPayload } from "@/utils/helperFunctions/inboxHelpers";
import type { FirstScreenInitialModel, FirstScreenWireValue } from "./contract";
import { BOARD_FIRST_SCREEN_FLAG } from "./boardDocument";

export const INBOX_DOCUMENT_ROUTE_HEADER = "x-ht-inbox-document-route";
export const INBOX_DOCUMENT_TIMEOUT_MS = 800;

export type InboxDocument = FirstScreenInitialModel<FirstScreenWireValue> & {
  data: {
    user: IUser;
    payload: InboxQueryPayload;
    drafts: IUserDraft[];
    displayAvatar: DisplayAvatar;
    counts: { all: number; unseen: number };
    isInboxZero: boolean;
    zeroImage: string | null;
    nudge: { visible: boolean; pushDenied: boolean };
  };
};

export function getInboxDocument(snapshot: FirstScreenInitialModel<FirstScreenWireValue> | null, accountId: number): InboxDocument | null {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.scope.accountId !== accountId || snapshot.scope.route !== "/inbox" ||
      snapshot.authorization.outcome !== "authorized" || snapshot.flags.accountId !== accountId ||
      !Number.isFinite(Date.parse(snapshot.fetchedAt)) || snapshot.completeness !== "complete" ||
      snapshot.flags.values[BOARD_FIRST_SCREEN_FLAG] !== true) return null;
  const data = snapshot.data as unknown as InboxDocument["data"];
  return data?.user?.id === accountId && data.payload?.accountId === accountId &&
    Array.isArray(data.payload.notifications) && Array.isArray(data.drafts) &&
    Number.isInteger(snapshot.selection.split) && snapshot.selection.split! >= 0 &&
    snapshot.selection.split! < data.payload.structuredData?.data.length
    ? snapshot as InboxDocument : null;
}

export function activeInboxDrafts(drafts: readonly IUserDraft[], payload: InboxQueryPayload, split: number) {
  const taskIds = new Set(payload.structuredData.data[split]?.map(row => row.taskId));
  return drafts.filter(draft => draft.type === "Comment" && draft.saved !== true &&
    (payload.structuredData.tabs[split]?.project === "All" || taskIds.has(draft.taskId)));
}
