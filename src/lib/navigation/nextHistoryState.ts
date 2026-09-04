export const getNextRouterAwareHistoryState = (
  currentState: Record<string, unknown> | null,
): Record<string, unknown> => {
  const state = { ...(currentState ?? {}) };

  // Next's patched history methods skip router updates for states already
  // marked as internal. They restore these markers after handling this call.
  delete state.__NA;
  delete state._N;

  return state;
};
