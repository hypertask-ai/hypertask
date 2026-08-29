import Blockquote from "@tiptap/extension-blockquote";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import {
  REPLY_QUOTE_DATA_ATTRIBUTE,
  REPLY_QUOTE_NODE_ATTRIBUTE,
} from "@/lib/richText/replyQuote";

interface ReplyBlockquoteEnterContext {
  state: EditorState;
  dispatch?: (transaction: Transaction) => void;
}

type VerticalArrowDirection = "up" | "down";

interface BlockquoteArrowContext extends ReplyBlockquoteEnterContext {
  direction: VerticalArrowDirection;
  endOfTextblock: (direction: VerticalArrowDirection) => boolean;
}

/**
 * Replies saved before replyQuote existed can only be identified by the exact
 * attribution structure emitted by wrapBlockQuote: a generated mention and
 * the word "said" in the paragraph immediately before the blockquote.
 */
export function isLegacyGeneratedReplyBlockquote(
  element: HTMLElement,
): boolean {
  const attribution = element.previousElementSibling;
  if (attribution?.tagName !== "P" || attribution.children.length !== 1) {
    return false;
  }

  const mention = attribution.firstElementChild;
  if (
    mention?.tagName !== "SPAN" ||
    mention.getAttribute("data-type") !== "mention" ||
    !mention.classList.contains("mention") ||
    !mention.hasAttribute("data-id") ||
    !mention.hasAttribute("data-label") ||
    !mention.hasAttribute("uniqueindex") ||
    !mention.hasAttribute("projectid")
  ) {
    return false;
  }

  // AI-generated quote context used a distinct mention signature and should
  // retain ordinary blockquote behavior.
  if (
    mention.getAttribute("data-label") === "name" &&
    mention.hasAttribute("text")
  ) {
    return false;
  }

  const attributionText = Array.from(attribution.childNodes)
    .filter((node) => node !== mention)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();

  return attributionText === "said";
}

/**
 * A quoted reply is read-only source material from another comment. Its first
 * Enter should move the author into a normal paragraph after the whole quote,
 * without splitting or changing the quoted content. Untagged/manual quotes
 * return false so ProseMirror keeps its standard blockquote behavior.
 */
export function exitReplyBlockquoteOnEnter({
  state,
  dispatch,
}: ReplyBlockquoteEnterContext): boolean {
  const { $from } = state.selection;
  let replyQuoteDepth = -1;

  for (let depth = 1; depth <= $from.depth; depth += 1) {
    const node = $from.node(depth);
    if (
      node.type.name === "blockquote" &&
      node.attrs[REPLY_QUOTE_NODE_ATTRIBUTE] === true
    ) {
      replyQuoteDepth = depth;
      break;
    }
  }

  if (replyQuoteDepth < 0) return false;

  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;

  const positionAfterQuote = $from.after(replyQuoteDepth);
  let transaction = state.tr;
  const nodeAfterQuote = transaction.doc.resolve(positionAfterQuote).nodeAfter;
  const hasEmptyParagraphAfterQuote =
    nodeAfterQuote?.type === paragraph && nodeAfterQuote.content.size === 0;

  if (!hasEmptyParagraphAfterQuote) {
    transaction = transaction.insert(positionAfterQuote, paragraph.create());
  }

  transaction = transaction.setSelection(
    TextSelection.near(transaction.doc.resolve(positionAfterQuote + 1), 1)
  );
  dispatch?.(transaction.scrollIntoView());
  return true;
}

function findOutermostBlockquoteDepth(state: EditorState): number {
  const { $from } = state.selection;

  for (let depth = 1; depth <= $from.depth; depth += 1) {
    if ($from.node(depth).type.name === "blockquote") return depth;
  }

  return -1;
}

function selectionEndsBlockquoteBranch(
  state: EditorState,
  blockquoteDepth: number
): boolean {
  const { $from } = state.selection;

  for (let depth = blockquoteDepth; depth < $from.depth; depth += 1) {
    if ($from.indexAfter(depth) !== $from.node(depth).childCount) return false;
  }

  return true;
}

/**
 * Some browsers leave vertical arrow movement inside a blockquote when the
 * caret reaches its visual edge. Handle only that boundary and let native
 * movement continue everywhere else.
 */
export function moveAcrossBlockquoteOnArrow({
  state,
  dispatch,
  direction,
  endOfTextblock,
}: BlockquoteArrowContext): boolean {
  const { selection } = state;
  if (
    !(selection instanceof TextSelection) ||
    !selection.empty ||
    !selection.$from.parent.isTextblock ||
    !endOfTextblock(direction)
  ) {
    return false;
  }

  const { $from } = selection;

  if (direction === "down") {
    const blockquoteDepth = findOutermostBlockquoteDepth(state);
    if (
      blockquoteDepth < 0 ||
      !selectionEndsBlockquoteBranch(state, blockquoteDepth)
    ) {
      return false;
    }

    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) return false;

    const positionAfterQuote = $from.after(blockquoteDepth);
    let transaction = state.tr;
    const nodeAfterQuote = transaction.doc.resolve(positionAfterQuote).nodeAfter;
    if (!nodeAfterQuote) {
      transaction = transaction.insert(positionAfterQuote, paragraph.create());
    }

    transaction = transaction.setSelection(
      TextSelection.near(transaction.doc.resolve(positionAfterQuote), 1)
    );
    dispatch?.(transaction.scrollIntoView());
    return true;
  }

  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const positionBeforeNode = $from.before(depth);
    const nodeBefore = state.doc.resolve(positionBeforeNode).nodeBefore;
    if (nodeBefore?.type.name === "blockquote") {
      const transaction = state.tr.setSelection(
        TextSelection.near(state.doc.resolve(positionBeforeNode - 1), -1)
      );
      dispatch?.(transaction.scrollIntoView());
      return true;
    }

    if (depth > 1 && $from.index(depth - 1) > 0) return false;
  }

  return false;
}

export const ReplyBlockquote = Blockquote.extend({
  addAttributes() {
    const parentAttributes =
      typeof this.parent === "function" ? this.parent() : {};

    return {
      ...parentAttributes,
      [REPLY_QUOTE_NODE_ATTRIBUTE]: {
        default: false,
        parseHTML: (element) =>
          element.hasAttribute(REPLY_QUOTE_DATA_ATTRIBUTE) ||
          isLegacyGeneratedReplyBlockquote(element),
        renderHTML: (attributes) =>
          attributes[REPLY_QUOTE_NODE_ATTRIBUTE]
            ? { [REPLY_QUOTE_DATA_ATTRIBUTE]: "true" }
            : {},
      },
    };
  },

  addKeyboardShortcuts() {
    const moveAcrossBoundary = (direction: VerticalArrowDirection) =>
      moveAcrossBlockquoteOnArrow({
        state: this.editor.state,
        direction,
        endOfTextblock: (arrowDirection) =>
          this.editor.view.endOfTextblock(arrowDirection),
        dispatch: (transaction) => this.editor.view.dispatch(transaction),
      });

    return {
      ...this.parent?.(),
      Enter: () =>
        exitReplyBlockquoteOnEnter({
          state: this.editor.state,
          dispatch: (transaction) => this.editor.view.dispatch(transaction),
        }),
      ArrowDown: () => moveAcrossBoundary("down"),
      ArrowUp: () => moveAcrossBoundary("up"),
    };
  },
});
