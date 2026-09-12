import { canScrollX } from "@/lib/kanban/boardEdgeAutoScroll";

type BoardDocument = Pick<Document, "getElementById">;

type BoardDocumentLike = BoardDocument & {
  defaultView?: Pick<Window, "getComputedStyle"> | null;
  scrollingElement?: Element | null;
};

const findBoardScroller = (
  doc: BoardDocumentLike,
  board: HTMLElement | null,
): HTMLElement | null => {
  const sections = doc.getElementById("sectionsContainer");
  const page = (doc.scrollingElement as HTMLElement | null) ?? null;
  const boardWrapper =
    typeof board?.closest === "function"
      ? board.closest<HTMLElement>(".homepage-container-tag")
      : null;
  const candidates = [boardWrapper, board, sections, page].filter(
    (candidate, index, all): candidate is HTMLElement =>
      candidate !== null && all.indexOf(candidate) === index,
  );

  return (
    candidates.find((candidate) =>
      canScrollX({
        scrollWidth: candidate.scrollWidth,
        clientWidth: candidate.clientWidth,
        overflowX:
          doc.defaultView?.getComputedStyle(candidate).overflowX ?? "visible",
        isPageScroller: candidate === page,
      }),
    ) ?? null
  );
};

/**
 * Keep a newly created board column visible after the board grows horizontally.
 *
 * The board's horizontal scroll may live on its wrapper or the page.
 * `scrollIntoView` can also move a column's vertical scroller, so adjust only
 * the actual horizontal scroller by the amount the column is clipped.
 */
export const scrollBoardColumnIntoView = (
  sectionId: number,
  documentLike?: BoardDocumentLike,
): boolean => {
  const doc =
    documentLike ??
    (typeof document === "undefined" ? undefined : document);
  if (!doc) return false;

  const column = doc.getElementById(`droppable-section-container-${sectionId}`);
  const board = doc.getElementById("kanban-sections-container");
  if (!column) return false;

  const columnRect = column.getBoundingClientRect();
  const scroller = findBoardScroller(doc, board);
  if (!scroller) {
    if (!board) return false;
    const boardRect = board.getBoundingClientRect();
    return columnRect.left >= boardRect.left && columnRect.right <= boardRect.right;
  }

  const scrollerRect =
    scroller === doc.scrollingElement
      ? {
          left: 0,
          right: scroller.clientWidth,
        }
      : scroller.getBoundingClientRect();
  const leftOverflow = columnRect.left - scrollerRect.left;
  const rightOverflow = columnRect.right - scrollerRect.right;
  let scrollDelta = 0;
  if (leftOverflow < 0) {
    scrollDelta = leftOverflow;
  } else if (rightOverflow > 0) {
    scrollDelta = rightOverflow;
  }

  if (scrollDelta !== 0) {
    scroller.scrollBy({ left: scrollDelta, behavior: "auto" });
  }
  return true;
};

type RevealBoardColumnOptions = {
  documentLike?: BoardDocumentLike;
  schedule?: (callback: () => void) => void;
  maxAttempts?: number;
};

/**
 * Wait for React to mount a just-created column, then reveal it.
 *
 * A busy board can commit the cache update after several animation frames. The
 * old 10-frame loop stopped after roughly 170 ms, leaving the new column off
 * screen even though the create request succeeded. Retry for up to five seconds
 * with one pending timer at a time, and stop as soon as the column is present.
 */
export type ViewSwitchScrollState = {
  projectId?: number;
  viewId?: string;
};

/**
 * HTPR-6333: keep the focused card, but do not keep the previous view's
 * horizontal offset. First paint and board changes still leave the remembered
 * card-navigation scroll alone.
 */
export const shouldRevealFocusOnViewSwitch = (
  previous: ViewSwitchScrollState | null,
  next: ViewSwitchScrollState,
): boolean => {
  if (!next.projectId || !next.viewId) return false;
  if (!previous?.projectId || !previous.viewId) return false;
  if (previous.projectId !== next.projectId) return false;
  return previous.viewId !== next.viewId;
};

/**
 * Smallest scrollLeft that keeps the focused card fully visible, preferring 0.
 */
export const preferredScrollLeftToShowFocus = ({
  scrollLeft,
  viewportWidth,
  cardLeftInViewport,
  cardRightInViewport,
}: {
  scrollLeft: number;
  viewportWidth: number;
  cardLeftInViewport: number | null;
  cardRightInViewport: number | null;
}): number => {
  if (!(viewportWidth > 0)) return 0;
  if (cardLeftInViewport == null || cardRightInViewport == null) return 0;

  const cardLeftInContent = cardLeftInViewport + scrollLeft;
  const cardRightInContent = cardRightInViewport + scrollLeft;
  const cardWidth = cardRightInContent - cardLeftInContent;
  if (cardWidth >= viewportWidth) return Math.max(0, cardLeftInContent);
  if (cardRightInContent <= viewportWidth) return 0;
  return Math.max(0, cardRightInContent - viewportWidth);
};

/**
 * After a view switch, snap the board as far left as it can go without hiding
 * the focused card. A missing card still resets to the left edge.
 */
export const scrollBoardToShowFocusFromLeft = (
  taskId: number | null | undefined,
  documentLike?: BoardDocumentLike,
): boolean => {
  const doc =
    documentLike ??
    (typeof document === "undefined" ? undefined : document);
  if (!doc) return false;

  const board = doc.getElementById("kanban-sections-container");
  const scroller = findBoardScroller(doc, board);
  if (!scroller) return true;

  const card = taskId == null ? null : doc.getElementById(`task-${taskId}`);
  const scrollerRect =
    scroller === doc.scrollingElement
      ? { left: 0, right: scroller.clientWidth }
      : scroller.getBoundingClientRect();
  const cardRect = card?.getBoundingClientRect() ?? null;
  const nextScrollLeft = preferredScrollLeftToShowFocus({
    scrollLeft: scroller.scrollLeft,
    viewportWidth: scroller.clientWidth,
    cardLeftInViewport: cardRect ? cardRect.left - scrollerRect.left : null,
    cardRightInViewport: cardRect ? cardRect.right - scrollerRect.left : null,
  });

  if (scroller.scrollLeft !== nextScrollLeft) {
    scroller.scrollLeft = nextScrollLeft;
  }
  return true;
};

export const revealBoardColumnAfterRender = (
  sectionId: number,
  options: RevealBoardColumnOptions = {},
): void => {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 100);
  const schedule =
    options.schedule ??
    ((callback: () => void) => {
      globalThis.setTimeout(callback, 50);
    });
  let attempts = 0;

  const reveal = () => {
    attempts += 1;
    if (scrollBoardColumnIntoView(sectionId, options.documentLike)) return;
    if (attempts < maxAttempts) schedule(reveal);
  };

  reveal();
};
