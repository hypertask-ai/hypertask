import {
  compareInboxReadModelRevisions,
  type InboxReadModelRevision,
} from "./revision";

export const isStaleInboxHydration = ({
  payloadRevision,
  observedRevision,
  networkRequestRevision,
  floorBeforeNetworkRequest,
  queryRevision,
  keepFloorBeforeNetworkRequest,
}: {
  payloadRevision: InboxReadModelRevision;
  observedRevision: InboxReadModelRevision | null;
  networkRequestRevision: InboxReadModelRevision | null;
  floorBeforeNetworkRequest: InboxReadModelRevision | null;
  queryRevision: InboxReadModelRevision | null;
  keepFloorBeforeNetworkRequest: boolean;
}): boolean => {
  const observedFloor =
    observedRevision === networkRequestRevision
      ? keepFloorBeforeNetworkRequest
        ? floorBeforeNetworkRequest
        : null
      : observedRevision;
  return [observedFloor, queryRevision].some(
    (candidate) =>
      candidate != null &&
      compareInboxReadModelRevisions(payloadRevision, candidate) < 0,
  );
};
