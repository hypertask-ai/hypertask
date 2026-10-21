export const stableClientRect = (
  getClientRect: (() => DOMRect | null | undefined) | undefined
): (() => DOMRect) => {
  let lastRect: DOMRect | null = null;

  return () => {
    const rect = typeof getClientRect === "function" ? getClientRect() : null;
    if (rect) {
      lastRect = rect;
      return rect;
    }
    return lastRect ?? new DOMRect(0, 0, 0, 0);
  };
};
