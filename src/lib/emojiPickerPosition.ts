/**
 * Viewport-fixed coordinates for emoji pickers portaled to #portal-root.
 * Document-absolute + scrollY placement sits under the new comment composer
 * when that field owns a higher stacking context (HTPR-6404).
 */
export type FixedOverlayPosition = {
  top: number;
  left: number;
};

export function getFixedOverlayPosition(
  rect: Pick<DOMRect, "top" | "bottom" | "left">,
  opts: {
    height: number;
    width: number;
    viewportHeight: number;
    viewportWidth: number;
    gap?: number;
    padding?: number;
  },
): FixedOverlayPosition {
  const gap = opts.gap ?? 4;
  const padding = opts.padding ?? 8;
  const spaceBelow = opts.viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  const showAbove =
    spaceBelow < opts.height && spaceAbove > opts.height;

  const top = showAbove
    ? Math.max(padding, rect.top - opts.height - gap)
    : Math.min(
        rect.bottom + gap,
        Math.max(padding, opts.viewportHeight - opts.height - padding),
      );

  const left = Math.max(
    padding,
    Math.min(rect.left, opts.viewportWidth - opts.width - padding),
  );

  return { top, left };
}
