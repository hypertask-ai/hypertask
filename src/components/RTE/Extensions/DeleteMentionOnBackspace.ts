import { Extension, type AnyExtension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";

export const DeleteMentionOnBackspace = Extension.create({
  name: "deleteMentionOnBackspace",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            beforeinput: (view, event) => {
              const inputEvent = event as InputEvent;
              const { selection } = view.state;

              if (
                !view.editable ||
                !inputEvent.cancelable ||
                inputEvent.inputType !== "deleteContentBackward" ||
                !(selection instanceof TextSelection) ||
                !selection.empty
              ) {
                return false;
              }

              // Gboard may mark backward deletion as composing. The adjacent
              // mention check keeps that event safe without ignoring it.
              const mention = selection.$from.nodeBefore;
              if (mention?.type.name !== "mention") return false;

              inputEvent.preventDefault();
              view.dispatch(
                view.state.tr
                  .delete(selection.from - mention.nodeSize, selection.from)
                  .scrollIntoView()
              );
              return true;
            },
          },
        },
      }),
    ];
  },
});

export const withMentionBackspaceDeletion = (mention: AnyExtension) => [
  mention.configure({ deleteTriggerWithBackspace: true }),
  DeleteMentionOnBackspace,
];
