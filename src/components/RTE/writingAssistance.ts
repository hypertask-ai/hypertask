import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
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

// HTPR-6906: remembers the last automatic capital so Backspace or Ctrl/Cmd+Z
// right after it can bring the lowercase letter back. Cleared by any other edit
// or cursor move; `hint` (the brief underline) also clears on a timer.
type AutoCapital = { pos: number; original: string; capital: string; hint: boolean };
const autoCapitalKey = new PluginKey<AutoCapital | null>("autoCapitalUndo");
const AUTO_CAPITAL_HINT_MS = 1800;

function capitalizeTypedSentenceStart(
  localCapitalizationEnabled: () => boolean,
  undoEnabled: () => boolean,
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

  const tr = view.state.tr.insertText(capitalized, from, to).scrollIntoView();
  if (undoEnabled()) {
    tr.setMeta(autoCapitalKey, { pos: from, original: text, capital: capitalized, hint: true });
  }
  view.dispatch(tr);
  return true;
}

function restoreLowercase(undoEnabled: () => boolean, view: EditorView, event: KeyboardEvent) {
  const last = autoCapitalKey.getState(view.state);
  const isUndo =
    (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z";
  const isBackspace = event.key === "Backspace" && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (!last || !undoEnabled() || !(isUndo || isBackspace)) return false;
  const { selection, doc } = view.state;
  if (
    !selection.empty ||
    selection.from !== last.pos + last.capital.length ||
    doc.textBetween(last.pos, selection.from) !== last.capital
  ) {
    return false;
  }
  view.dispatch(
    view.state.tr
      .insertText(last.original, last.pos, selection.from)
      .setMeta(autoCapitalKey, null),
  );
  return true;
}

export const LocalWritingAssistance = Extension.create<{
  localCapitalizationEnabled: () => boolean;
  undoCapitalizationEnabled: () => boolean;
}>({
  name: "localWritingAssistance",

  addOptions() {
    return {
      localCapitalizationEnabled: () => false,
      undoCapitalizationEnabled: () => false,
    };
  },

  // Run before the history keymap so Ctrl/Cmd+Z can restore the lowercase letter.
  priority: 1000,

  addProseMirrorPlugins() {
    const { localCapitalizationEnabled, undoCapitalizationEnabled } = this.options;
    const undoEnabled = () => localCapitalizationEnabled() && undoCapitalizationEnabled();
    return [
      new Plugin<AutoCapital | null>({
        key: autoCapitalKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(autoCapitalKey);
            if (meta !== undefined) return meta;
            if (!value) return null;
            if (tr.docChanged || tr.selectionSet) return null;
            return value;
          },
        },
        view: (view) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          return {
            update() {
              const value = autoCapitalKey.getState(view.state);
              if (timer) clearTimeout(timer);
              timer = undefined;
              if (!value?.hint) return;
              timer = setTimeout(() => {
                const current = autoCapitalKey.getState(view.state);
                if (current?.hint && !view.isDestroyed) {
                  view.dispatch(view.state.tr.setMeta(autoCapitalKey, { ...current, hint: false }));
                }
              }, AUTO_CAPITAL_HINT_MS);
            },
            destroy() {
              if (timer) clearTimeout(timer);
            },
          };
        },
        props: {
          decorations: (state) => {
            const value = autoCapitalKey.getState(state);
            if (!value?.hint) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(value.pos, value.pos + value.capital.length, {
                style: "text-decoration: underline",
              }),
            ]);
          },
          handleKeyDown: (view, event) => restoreLowercase(undoEnabled, view, event),
          handleTextInput: (view, from, to, text) =>
            capitalizeTypedSentenceStart(
              localCapitalizationEnabled,
              undoEnabled,
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
