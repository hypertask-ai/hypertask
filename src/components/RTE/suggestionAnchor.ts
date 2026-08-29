/**
 * Keeps a suggestion popup anchored to the caret.
 *
 * Tiptap's suggestion plugin hands tippy a `clientRect` function that returns
 * null once the range stops resolving: the editor blurs, the node goes away,
 * the document changes underneath it. Tippy reads null as "no reference" and
 * positions the popup at the document origin, which is how the @-mention list
 * ended up in the bottom-left corner (HTPR-3383).
 *
 * Remembering the last good rect keeps the popup where the user was typing.
 * Before there is any rect at all, a zero rect is returned rather than null,
 * because tippy only needs something well-formed.
 */
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
