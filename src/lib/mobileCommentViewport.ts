export const MOBILE_COMMENT_MIN_EDITOR_HEIGHT = 39;
export const MOBILE_COMMENT_AUTO_VIEWPORT_RATIO = 0.55;
export const MOBILE_COMMENT_MANUAL_VIEWPORT_RATIO = 0.8;
export const MOBILE_OVERLAY_SHEET_MAX_HEIGHT_RATIO = 0.85;

interface MobileCommentViewportInput {
  layoutViewportHeight: number;
  visualViewportHeight: number;
  visualViewportOffsetTop: number;
  dockInset: number;
  composerChromeHeight: number;
  requestedEditorHeight: number | null;
}

export interface MobileVisualViewportInput {
  layoutViewportHeight: number;
  visualViewportHeight: number;
  visualViewportOffsetTop: number;
}

export interface MobileVisualViewportGeometry {
  bottomInset: number;
  visibleHeight: number;
}

export interface MobileCommentViewportGeometry {
  bottomInset: number;
  autoEditorMaxHeight: number;
  manualEditorMaxHeight: number;
  renderedEditorHeight: number | null;
}

const finiteNonNegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

/** Tab bar is h-16 plus the 1px top border. Used when --mobile-dock-h is 0px or short. */
export const MOBILE_PRIMARY_DOCK_MIN_PX = 65;

export const parseCssPixelLength = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

/**
 * Agent Chat keeps the tab bar visible, unlike AI Chat which hides it while
 * typing. A published 0px or short dock var must not drop the composer into
 * the tab bar after a reload. When the keyboard is open, visibleHeight already
 * ends at the keyboard, so extra dock padding would leave a dead gap.
 */
export const getAgentChatMobileBottomInset = ({
  dockHeight,
  keyboardInset,
}: {
  dockHeight: number;
  keyboardInset: number;
}): number => {
  if (finiteNonNegative(keyboardInset) > 0) return 0;
  return Math.max(
    finiteNonNegative(dockHeight),
    MOBILE_PRIMARY_DOCK_MIN_PX,
  );
};

export const getMobileVisualViewportGeometry = ({
  layoutViewportHeight,
  visualViewportHeight,
  visualViewportOffsetTop,
}: MobileVisualViewportInput): MobileVisualViewportGeometry => {
  const layoutHeight = finiteNonNegative(layoutViewportHeight);
  const visualHeight = finiteNonNegative(visualViewportHeight);
  const visualOffsetTop = finiteNonNegative(visualViewportOffsetTop);
  const visualViewportBottom = visualOffsetTop + visualHeight;
  const bottomInset = Math.max(0, layoutHeight - visualViewportBottom);

  return {
    bottomInset,
    visibleHeight: Math.min(
      visualHeight,
      Math.max(0, layoutHeight - visualOffsetTop - bottomInset)
    ),
  };
};

export const getMobileCommentViewportGeometry = ({
  layoutViewportHeight,
  visualViewportHeight,
  visualViewportOffsetTop,
  dockInset,
  composerChromeHeight,
  requestedEditorHeight,
}: MobileCommentViewportInput): MobileCommentViewportGeometry => {
  const { bottomInset: keyboardInset, visibleHeight } =
    getMobileVisualViewportGeometry({
      layoutViewportHeight,
      visualViewportHeight,
      visualViewportOffsetTop,
    });
  const dockHeight = finiteNonNegative(dockInset);
  const chromeHeight = finiteNonNegative(composerChromeHeight);
  const bottomInset = Math.max(keyboardInset, dockHeight);
  const availableViewportHeight = Math.max(
    0,
    visibleHeight - Math.max(0, bottomInset - keyboardInset)
  );
  const editorSpace = Math.max(
    MOBILE_COMMENT_MIN_EDITOR_HEIGHT,
    availableViewportHeight - chromeHeight
  );
  const autoEditorMaxHeight = Math.max(
    MOBILE_COMMENT_MIN_EDITOR_HEIGHT,
    Math.min(
      editorSpace,
      availableViewportHeight * MOBILE_COMMENT_AUTO_VIEWPORT_RATIO
    )
  );
  const manualEditorMaxHeight = Math.max(
    MOBILE_COMMENT_MIN_EDITOR_HEIGHT,
    Math.min(
      editorSpace,
      availableViewportHeight * MOBILE_COMMENT_MANUAL_VIEWPORT_RATIO -
        chromeHeight
    )
  );

  return {
    bottomInset,
    autoEditorMaxHeight,
    manualEditorMaxHeight,
    renderedEditorHeight:
      requestedEditorHeight === null
        ? null
        : Math.min(
            manualEditorMaxHeight,
            Math.max(MOBILE_COMMENT_MIN_EDITOR_HEIGHT, requestedEditorHeight)
          ),
  };
};

export interface MobileOverlaySheetViewportInput {
  layoutHeight: number;
  visibleHeight: number;
  bottomInset: number;
}

export interface MobileOverlaySheetContainerStyle {
  bottom: number;
  height: string;
  maxHeight: string;
}

/** Size mobile AI overlay sheets to the visible viewport (keyboard-aware). */
export const getMobileOverlaySheetContainerStyle = (
  viewport: MobileOverlaySheetViewportInput | null | undefined,
): MobileOverlaySheetContainerStyle | undefined => {
  if (!viewport) return undefined;

  const layoutHeight = finiteNonNegative(viewport.layoutHeight);
  const visibleHeight = finiteNonNegative(viewport.visibleHeight);
  const bottomInset = finiteNonNegative(viewport.bottomInset);
  const keyboardOpen = bottomInset > 0;
  const restingHeight = Math.min(
    visibleHeight,
    layoutHeight * MOBILE_OVERLAY_SHEET_MAX_HEIGHT_RATIO,
  );
  const sheetHeight = keyboardOpen ? visibleHeight : restingHeight;

  return {
    bottom: keyboardOpen ? bottomInset : 0,
    height: `${sheetHeight}px`,
    maxHeight: `${sheetHeight}px`,
  };
};
