export const createBoardRealtimeEventHandler = (
  refetch: (trigger: "event") => void,
) => {
  return () => refetch("event");
};

export const shouldUseScopedBoardReconcile = ({
  scopedRefetch,
  trigger,
  userId,
}: {
  scopedRefetch: boolean;
  trigger: "event" | "reconnect";
  userId: number | undefined;
}): boolean =>
  scopedRefetch && trigger === "event" && userId !== undefined;
