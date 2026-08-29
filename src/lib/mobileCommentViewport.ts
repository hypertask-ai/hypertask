export const MOBILE_COMMENT_MIN_EDITOR_HEIGHT = 39;
export const MOBILE_COMMENT_AUTO_VIEWPORT_RATIO = 0.55;
export const MOBILE_COMMENT_MANUAL_VIEWPORT_RATIO = 0.8;

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
