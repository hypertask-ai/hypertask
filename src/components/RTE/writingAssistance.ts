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
const abbreviationBeforeCursor =
  /(?:\b(?:vs|etc|fig|no|mr|mrs|ms|dr|prof|sr|jr|st)\.|(?:\p{L}\.){2,})["'”’)\]}]*\s+[\s"'“‘(\[{]*$/iu;

type AutoCapital =
  | { kind: "capital"; pos: number; original: string; capital: string; hint: boolean; allowUndo: boolean }
  | { kind: "retype"; pos: number };
const autoCapitalKey = new PluginKey<AutoCapital | null>("autoCapitalUndo");
const AUTO_CAPITAL_HINT_MS = 1800;

function capitalizeTypedSentenceStart(
  localCapitalizationEnabled: () => boolean,
  undoEnabled: () => boolean,
  retypeEnabled: () => boolean,
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

  const last = autoCapitalKey.getState(view.state);
  if (retypeEnabled() && last?.pos === from && (last.kind === "retype" || to > from)) {
    return false;
  }

  const textAfter = view.state.doc.resolve(to).nodeAfter;
  if (undoEnabled() && textAfter?.isText && /^[\p{L}\p{N}]/u.test(textAfter.text ?? "")) {
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
  if (undoEnabled() || retypeEnabled()) {
    tr.setMeta(autoCapitalKey, {
      kind: "capital", pos: from, original: text, capital: capitalized,
      hint: undoEnabled(), allowUndo: undoEnabled(),
    });
  }
  view.dispatch(tr);
  return true;
}

function restoreLowercase(undoEnabled: () => boolean, view: EditorView, event: KeyboardEvent) {
  const last = autoCapitalKey.getState(view.state);
  const isUndo =
    (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z";
  const isBackspace = event.key === "Backspace" && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (last?.kind !== "capital" || !last.allowUndo || !undoEnabled() || !(isUndo || isBackspace)) return false;
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
  retypeLowercaseEnabled: () => boolean;
}>({
  name: "localWritingAssistance",

  addOptions() {
    return {
      localCapitalizationEnabled: () => false,
      undoCapitalizationEnabled: () => false,
      retypeLowercaseEnabled: () => false,
    };
  },

  priority: 1000,

  addProseMirrorPlugins() {
    const { localCapitalizationEnabled, undoCapitalizationEnabled, retypeLowercaseEnabled } = this.options;
    const undoEnabled = () => localCapitalizationEnabled() && undoCapitalizationEnabled();
    const retypeEnabled = () => localCapitalizationEnabled() && retypeLowercaseEnabled();
    return [
      new Plugin<AutoCapital | null>({
        key: autoCapitalKey,
        state: {
          init: () => null,
          apply(tr, value, oldState) {
            const meta = tr.getMeta(autoCapitalKey);
            if (meta !== undefined) return meta;
            if (!value) return null;
            if (!retypeEnabled()) {
              if (tr.docChanged || tr.selectionSet) return null;
              return value;
            }
            if (value.kind === "retype") {
              if (tr.docChanged || (tr.selectionSet && tr.selection.from !== value.pos)) return null;
              return value;
            }
            if (tr.docChanged) {
              const mapped = tr.mapping.mapResult(value.pos);
              if (mapped.deleted) {
                if (
                  oldState.selection.from === 0 && oldState.selection.to === tr.before.content.size &&
                  tr.doc.childCount === 1 && tr.doc.firstChild?.isTextblock &&
                  tr.doc.firstChild.content.size === 0 && tr.selection.from === 1
                ) return { kind: "retype", pos: 1 };
                const $mapped = tr.doc.resolve(mapped.pos);
                const paragraphStart = tr.mapping.map(tr.before.resolve(value.pos).start(), -1);
                if (!$mapped.parent.isTextblock || $mapped.start() !== paragraphStart) return null;
                return { kind: "retype", pos: mapped.pos };
              }
              if (tr.doc.textBetween(mapped.pos, mapped.pos + value.capital.length) !== value.capital) return null;
              return { ...value, pos: mapped.pos, allowUndo: false };
            }
            if (tr.selectionSet) return { ...value, allowUndo: false, hint: false };
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
              if (value?.kind !== "capital" || !value.hint) return;
              timer = setTimeout(() => {
                const current = autoCapitalKey.getState(view.state);
                if (current?.kind === "capital" && current.hint && !view.isDestroyed) {
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
            if (value?.kind !== "capital" || !value.hint) return null;
            let length = value.capital.length;
            if (retypeEnabled()) {
              const text = state.doc.resolve(value.pos).nodeAfter?.text ?? "";
              length = text.match(/^[\p{L}\p{M}\p{N}’'-]+/u)?.[0].length ?? length;
            }
            return DecorationSet.create(state.doc, [
              Decoration.inline(value.pos, value.pos + length, {
                style: "text-decoration: underline",
              }),
            ]);
          },
          handleKeyDown: (view, event) => restoreLowercase(undoEnabled, view, event),
          handleTextInput: (view, from, to, text) =>
            capitalizeTypedSentenceStart(
              localCapitalizationEnabled,
              undoEnabled,
              retypeEnabled,
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
