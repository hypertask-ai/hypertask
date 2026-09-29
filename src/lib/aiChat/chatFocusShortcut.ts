export const isControlQFocusShortcut = (
  event: Event,
): boolean => {
  const keyboardEvent = event as Partial<KeyboardEvent>;

  return (
    typeof keyboardEvent.key === "string" &&
    keyboardEvent.key.toLowerCase() === "q" &&
    keyboardEvent.ctrlKey === true &&
    keyboardEvent.metaKey !== true &&
    keyboardEvent.altKey !== true &&
    keyboardEvent.shiftKey !== true &&
    keyboardEvent.repeat !== true
  );
};
