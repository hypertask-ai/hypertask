import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
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
const sentenceStart = /(?:^|[.!?]["'”’)\]}]*\s+)[\s"'“‘(\[{]*$/u;
// ponytail: This list blocks common English false positives. Add another entry
// if production shows a recurring abbreviation that users type mid-sentence.
const abbreviationBeforeCursor =
  /(?:\b(?:vs|etc|fig|no|mr|mrs|ms|dr|prof|sr|jr|st)\.|(?:\p{L}\.){2,})["'”’)\]}]*\s+[\s"'“‘(\[{]*$/iu;

function capitalizeTypedSentenceStart(
  localCapitalizationEnabled: () => boolean,
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
  if (
    !sentenceStart.test(textBefore) ||
    abbreviationBeforeCursor.test(textBefore)
  ) {
    return false;
  }

  const capitalized = text.toLocaleUpperCase();
  if (capitalized === text || [...capitalized].length !== 1) return false;

  view.dispatch(view.state.tr.insertText(capitalized, from, to).scrollIntoView());
  return true;
}

export const LocalWritingAssistance = Extension.create<{
  localCapitalizationEnabled: () => boolean;
}>({
  name: "localWritingAssistance",

  addOptions() {
    return {
      localCapitalizationEnabled: () => false,
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput: (view, from, to, text) =>
            capitalizeTypedSentenceStart(
              this.options.localCapitalizationEnabled,
              view,
              from,
              to,
              text,
            ),
        },
      }),
    ];
  },
});
