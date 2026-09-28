import {
  commands,
  defaultBlockAt,
  Extension,
  getSplittedAttributes,
  type CommandProps,
} from "@tiptap/core";
import type { Attrs, NodeType } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";

type SplitType = {
  type: NodeType;
  attrs?: Attrs | null;
} | null;

function canSplitAfterDeletingSelection({ tr, editor }: CommandProps) {
  const { selection } = tr;
  if (
    !(selection instanceof TextSelection) ||
    selection.empty ||
    selection.$from.parent === selection.$to.parent
  ) {
    return true;
  }

  const { $from, $to } = selection;
  const defaultNode =
    $from.depth === 0
      ? undefined
      : defaultBlockAt($from.node(-1).contentMatchAt($from.indexAfter(-1)));
  const splitAttributes = getSplittedAttributes(
    editor.extensionManager.attributes,
    $from.node().type.name,
    $from.node().attrs,
  );
  const atEnd = $to.parentOffset === $to.parent.content.size;
  let types: SplitType[] | undefined =
    atEnd && defaultNode
      ? [{ type: defaultNode, attrs: splitAttributes }]
      : undefined;

  const deletedTransaction = EditorState.create({
    doc: tr.doc,
    selection,
  }).tr.deleteSelection();
  const splitPosition = deletedTransaction.mapping.map($from.pos);
  let canSafelySplit = canSplit(
    deletedTransaction.doc,
    splitPosition,
    1,
    types,
  );

  if (
    !types &&
    !canSafelySplit &&
    canSplit(
      deletedTransaction.doc,
      splitPosition,
      1,
      defaultNode ? [{ type: defaultNode }] : undefined,
    )
  ) {
    canSafelySplit = true;
    types = defaultNode
      ? [{ type: defaultNode, attrs: splitAttributes }]
      : undefined;
  }

  return canSafelySplit;
}

/**
 * Tiptap 3.31.3 validates splitBlock before deleting a cross-block selection,
 * then can split the changed document at an invalid depth. Remove this command
 * override after a Tiptap release includes upstream PR #8285.
 */
export const SafeSplitBlock = Extension.create({
  name: "safeSplitBlock",

  addCommands() {
    return {
      splitBlock:
        (options) =>
        (props): boolean => {
          if (!canSplitAfterDeletingSelection(props)) return false;
          return commands.splitBlock(options)(props);
        },
    };
  },
});
