export const getNextRouterAwareHistoryState = (
  currentState: Record<string, unknown> | null,
): Record<string, unknown> => {
  const state = { ...(currentState ?? {}) };

  delete state.__NA;
  delete state._N;

  return state;
};
