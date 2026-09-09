import type { EditorView } from "@tiptap/pm/view";

export const writingAssistanceEditorProps = Object.freeze({
  attributes: Object.freeze({
    spellcheck: "true",
    autocorrect: "on",
    autocapitalize: "sentences",
    writingsuggestions: "true",
  }),
});

const lowerCaseLetter = /^\p{Ll}$/u;
const sentenceStart = /(?:^\s*|[.!?]\s+)$/u;

export function createWritingAssistanceEditorProps(
  localCapitalizationEnabled: () => boolean,
) {
  return {
    ...writingAssistanceEditorProps,
    handleTextInput(
      view: EditorView,
      from: number,
      to: number,
      text: string,
    ) {
      if (
        !localCapitalizationEnabled() ||
        !view.editable ||
        view.composing ||
        !lowerCaseLetter.test(text)
      ) {
        return false;
      }

      const $from = view.state.doc.resolve(from);
      const activeMarks = view.state.storedMarks ?? $from.marks();
      if (
        !$from.parent.isTextblock ||
        $from.parent.type.spec.code ||
        activeMarks.some((mark) => mark.type.spec.code)
      ) {
        return false;
      }

      const textBefore = $from.parent.textBetween(
        0,
        $from.parentOffset,
        undefined,
        "\ufffc",
      );
      if (!sentenceStart.test(textBefore)) return false;

      const capitalized = text.toUpperCase();
      if (capitalized === text || [...capitalized].length !== 1) return false;

      view.dispatch(
        view.state.tr.insertText(capitalized, from, to).scrollIntoView(),
      );
      return true;
    },
  };
}
