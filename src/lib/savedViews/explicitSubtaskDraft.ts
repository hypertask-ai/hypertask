export const persistExplicitSubtaskDraft = (
  flagOn: boolean,
  requested: unknown,
  onDefaultView: boolean,
): boolean => flagOn && requested === true && onDefaultView
