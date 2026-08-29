export const mentionCommand = ({ editor, range, props }) => {
  const nodeAfter = editor.view.state.selection.$to.nodeAfter;
  const overrideSpace = nodeAfter?.text?.startsWith(" ");

  if (overrideSpace) {
    range.to += 1;
  }

  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      {
        type: "mention",
        attrs: { ...props, mentionSuggestionChar: "@" },
      },
      {
        type: "text",
        text: " ",
      },
    ])
    .run();

  const selection = editor.view.dom.ownerDocument.defaultView?.getSelection();
  if (selection && selection.rangeCount > 0) {
    selection.collapseToEnd();
  }
};
