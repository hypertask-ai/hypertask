export const createBoardRealtimeEventHandler = (
  refetch: (trigger: "event") => void,
) => {
  return () => refetch("event");
};
