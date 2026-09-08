// HTPR-6059: local replacement for @tiptap/extension-emoji's Emoji node.
// The package embeds its emoji dataset in the same module as the node and its
// default options reference the data, so any static import keeps the full
// dataset in the editor chunk that loads on every task open. This node reads
// the dataset exclusively through lazyEmojiData (filled on demand by a dynamic
// import), so the dataset only ships in an async chunk. Behavior otherwise
// mirrors the package node (3.29.2) so stored HTML, :shortcode: autocomplete,
// input/paste rules and commands behave identically.
import {
  combineTransactionSteps,
  escapeForRegEx,
  findChildrenInRange,
  getChangedRanges,
  InputRule,
  isFirefox,
  mergeAttributes,
  Node,
  nodeInputRule,
  PasteRule,
} from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import type { EmojiItem } from "@tiptap/extension-emoji";
import emojiRegex from "emoji-regex";
import { isEmojiSupported } from "is-emoji-supported";
import {
  ensureEmojiData,
  getEmojiItems,
  onEmojiDataInstalled,
} from "./lazyEmojiData";

export interface LazyEmojiOptions {
  HTMLAttributes: Record<string, any>;
  emojis: EmojiItem[];
  enableEmoticons: boolean;
  forceFallbackImages: boolean;
  suggestion: any;
}

const inputRegex = /:([a-zA-Z0-9_+-]+):$/;
const pasteRegex = /(^|\s):([a-zA-Z0-9_+-]+):/g;
const EmojiSuggestionPluginKey = new PluginKey("emojiSuggestion");

function removeDuplicates<T>(array: T[]): T[] {
  const seen: Record<string, true> = {};
  return array.filter((item) => {
    const key = JSON.stringify(item);
    return Object.prototype.hasOwnProperty.call(seen, key)
      ? false
      : (seen[key] = true);
  });
}

function removeVariationSelector(value: string): string {
  return value.replace("\uFE0E", "").replace("\uFE0F", "");
}

function shortcodeToEmoji(shortcode: string): EmojiItem | undefined {
  return getEmojiItems().find(
    (item) => shortcode === item.name || item.shortcodes.includes(shortcode)
  );
}

function emojiToShortcode(emoji: string): string | undefined {
  return getEmojiItems().find(
    (item) => item.emoji === removeVariationSelector(emoji)
  )?.shortcodes[0];
}

// Accepts a parsed span's text as a preserved glyph only when it is entirely
// emoji characters, so hand-written or foreign HTML cannot smuggle arbitrary
// text into the pre-load rendering path.
function isFullEmojiSequence(text: string): boolean {
  if (!text) return false;
  return text.replace(emojiRegex(), "").length === 0;
}

// The package builds these once at editor creation from its bundled data; we
// rebuild them lazily from the shared dataset and drop the caches when the
// data is installed, so empty-dataset editors stay data-independent.
let emoticonRegex: RegExp | null = null;
let supportMap: Record<string, boolean> | null = null;
onEmojiDataInstalled(() => {
  emoticonRegex = null;
  supportMap = null;
});

function getEmoticonRegex(): RegExp | null {
  if (emoticonRegex) return emoticonRegex;
  const emoticons = getEmojiItems()
    .flatMap((item) => item.emoticons ?? [])
    .filter((item): item is string => Boolean(item));
  if (emoticons.length === 0) return null;
  emoticonRegex = new RegExp(
    `(?:^|\\s)(${emoticons.map((item) => escapeForRegEx(item)).join("|")}) $`
  );
  return emoticonRegex;
}

// Mirrors the package's unicode-version support map, which decides whether an
// emoji renders as a glyph or as its CDN fallback image on older platforms.
function getSupportMap(): Record<string, boolean> {
  if (!supportMap) {
    const items = getEmojiItems();
    supportMap = removeDuplicates(
      items
        .map((item) => item.version)
        .filter((version): version is number => typeof version === "number")
    ).reduce<Record<string, boolean>>((versions, version) => {
      const emoji = items.find(
        (item) => item.version === version && item.emoji
      );
      const glyph = emoji?.emoji;
      return {
        ...versions,
        [version]: glyph ? isEmojiSupported(glyph) : false,
      };
    }, {});
  }
  return supportMap;
}

const LazyEmoji = Node.create<LazyEmojiOptions>({
  name: "emoji",
  inline: true,
  group: "inline",
  selectable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      emojis: getEmojiItems(),
      enableEmoticons: false,
      forceFallbackImages: false,
      suggestion: {
        char: ":",
        pluginKey: EmojiSuggestionPluginKey,
        command: ({ editor, range, props }: any) => {
          const nodeAfter = editor.view.state.selection.$to.nodeAfter;
          const overrideSpace = nodeAfter?.text?.startsWith(" ");
          if (overrideSpace) {
            range.to += 1;
          }
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: this.name, attrs: props },
              { type: "text", text: " " },
            ])
            .command(({ tr, state }: any) => {
              tr.setStoredMarks(
                state.doc.resolve(state.selection.to - 2).marks()
              );
              return true;
            })
            .run();
        },
        allow: ({ state, range }: any) => {
          const $from = state.doc.resolve(range.from);
          const type = state.schema.nodes[this.name];
          return !!$from.parent.type.contentMatch.matchType(type);
        },
      },
    };
  },

  // storage.emojis must stay the shared loader array by reference: the
  // autocomplete reads editor.storage.emoji.emojis and therefore observes the
  // dataset the moment it is installed.
  addStorage() {
    return {
      emojis: this.options.emojis,
      isSupported: (item: EmojiItem) =>
        item.version ? !!getSupportMap()[item.version] : false,
    };
  },

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-name"),
        renderHTML: (attributes) => ({
          "data-name": attributes.name,
        }),
      },
      // Preserves the rendered glyph of content stored before the dataset is
      // loaded, so HTML round-trips (draft sync, autosave) cannot degrade
      // existing emojis to ":name:" text while the data chunk is in flight.
      // Never serialized: rendering prefers the canonical dataset glyph once
      // the data is loaded, and falls back to this parsed glyph before that.
      glyph: {
        default: null,
        parseHTML: (element) => {
          const text = element.textContent ?? "";
          if (
            !text ||
            text === `:${element.getAttribute("data-name")}:` ||
            !isFullEmojiSequence(text)
          ) {
            return null;
          }
          return text;
        },
        renderHTML: () => null,
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const emojiItem = shortcodeToEmoji(node.attrs.name);
    const attributes = mergeAttributes(
      HTMLAttributes,
      this.options.HTMLAttributes,
      {
        "data-type": this.name,
      }
    );
    if (!emojiItem) {
      const glyph = typeof node.attrs.glyph === "string" ? node.attrs.glyph : null;
      return ["span", attributes, glyph ?? `:${node.attrs.name}:`];
    }
    const isSupported = this.storage.isSupported(emojiItem);
    const hasEmoji = !!emojiItem.emoji;
    const hasFallbackImage = !!emojiItem.fallbackImage;
    // Collapsed form of the package renderer's fallback condition.
    const renderFallbackImage = this.options.forceFallbackImages
      ? hasFallbackImage || !hasEmoji
      : (!isSupported || !hasEmoji) && hasFallbackImage;
    return [
      "span",
      attributes,
      renderFallbackImage
        ? [
            "img",
            {
              src: emojiItem.fallbackImage,
              draggable: "false",
              loading: "lazy",
              align: "absmiddle",
              alt: `${emojiItem.name} emoji`,
            },
          ]
        : emojiItem.emoji || `:${emojiItem.shortcodes[0]}:`,
    ];
  },

  renderText({ node }) {
    const glyph = typeof node.attrs.glyph === "string" ? node.attrs.glyph : null;
    if (glyph) return glyph;
    const emojiItem = shortcodeToEmoji(node.attrs.name);
    return emojiItem?.emoji || `:${node.attrs.name}:`;
  },

  renderMarkdown: (node) => {
    if (!node.attrs?.name) {
      return "";
    }
    return `:${node.attrs.name}:`;
  },

  addCommands() {
    return {
      setEmoji:
        (shortcode: string) =>
        ({ chain }) => {
          const emojiItem = shortcodeToEmoji(shortcode);
          if (!emojiItem) {
            return false;
          }
          chain()
            .insertContent({
              type: this.name,
              attrs: {
                name: emojiItem.name,
              },
            })
            .command(({ tr, state }) => {
              tr.setStoredMarks(
                state.doc.resolve(state.selection.to - 1).marks()
              );
              return true;
            })
            .run();
          return true;
        },
    };
  },

  addInputRules() {
    const inputRules = [
      new InputRule({
        find: inputRegex,
        handler: ({ range, match, chain }) => {
          const name = match[1];
          if (!shortcodeToEmoji(name)) {
            return;
          }
          chain()
            .insertContentAt(range, {
              type: this.name,
              attrs: {
                name,
              },
            })
            .command(({ tr, state }) => {
              tr.setStoredMarks(
                state.doc.resolve(state.selection.to - 1).marks()
              );
              return true;
            })
            .run();
        },
      }),
    ];
    if (this.options.enableEmoticons) {
      inputRules.push(
        nodeInputRule({
          // Data-independent find: the regex is derived from the (initially
          // empty) dataset and rebuilt when the data is installed.
          find: (text: string) => {
            const regex = getEmoticonRegex();
            if (!regex) return null;
            const match = regex.exec(text);
            if (!match) return null;
            return { text: match[0], index: match.index, replaceWith: match[1] };
          },
          type: this.type,
          getAttributes: (match) => {
            const emoji = getEmojiItems().find((item) =>
              item.emoticons?.includes(match[1])
            );
            if (!emoji) {
              return;
            }
            return {
              name: emoji.name,
            };
          },
        })
      );
    }
    return inputRules;
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: pasteRegex,
        handler: ({ range, match, chain }) => {
          const prefix = match[1] || "";
          const name = match[2];
          if (!shortcodeToEmoji(name)) {
            return;
          }
          const shortcodeFrom = range.from + prefix.length;
          const shortcodeTo = range.to;
          chain()
            .insertContentAt(
              { from: shortcodeFrom, to: shortcodeTo },
              {
                type: this.name,
                attrs: {
                  name,
                },
              },
              {
                updateSelection: false,
              }
            )
            .command(({ tr, state }) => {
              tr.setStoredMarks(
                state.doc.resolve(state.selection.to - 1).marks()
              );
              return true;
            })
            .run();
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
      new Plugin({
        key: new PluginKey("emoji"),
        props: {
          // Firefox cannot move the cursor past emoji nodes at paragraph
          // boundaries using arrow keys. We intercept plain (unmodified)
          // ArrowLeft/ArrowRight and manually resolve the correct position.
          // Only handles emoji nodes — other inline non-selectable nodes
          // (mentions, hard breaks) are out of scope for this extension.
          // See: https://github.com/ProseMirror/prosemirror/issues/1220
          handleKeyDown: (view, event) => {
            if (!isFirefox()) {
              return false;
            }
            const isLeft = event.key === "ArrowLeft";
            const isRight = event.key === "ArrowRight";
            if (!isLeft && !isRight) {
              return false;
            }
            if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
              return false;
            }
            const { state } = view;
            const { selection } = state;
            if (selection.empty || !(selection instanceof TextSelection)) {
              return false;
            }
            const $pos = selection.$from;
            const emojiType = this.type;
            if (isLeft) {
              const nodeBefore = $pos.nodeBefore;
              if (!nodeBefore || nodeBefore.type !== emojiType) {
                return false;
              }
              const newPos = $pos.pos - nodeBefore.nodeSize;
              if (newPos >= $pos.start()) {
                view.dispatch(
                  state.tr.setSelection(TextSelection.create(state.doc, newPos))
                );
                return true;
              }
            } else {
              const nodeAfter = $pos.nodeAfter;
              if (!nodeAfter || nodeAfter.type !== emojiType) {
                return false;
              }
              const newPos = $pos.pos + nodeAfter.nodeSize;
              if (newPos <= $pos.end()) {
                view.dispatch(
                  state.tr.setSelection(TextSelection.create(state.doc, newPos))
                );
                return true;
              }
            }
            return false;
          },
          // double click to select emoji doesn't work by default
          // that's why we simulate this behavior
          handleDoubleClickOn: (view, pos, node) => {
            if (node.type !== this.type) {
              return false;
            }
            const from = pos;
            const to = from + node.nodeSize;
            this.editor.commands.setTextSelection({ from, to });
            return true;
          },
        },
        // replace text emojis with emoji node on any change
        appendTransaction: (transactions, oldState, newState) => {
          if (this.editor.view.composing) {
            return;
          }
          const docChanges =
            transactions.some((transaction) => transaction.docChanged) &&
            !oldState.doc.eq(newState.doc);
          if (!docChanges) {
            return;
          }
          const { tr } = newState;
          const transform = combineTransactionSteps(
            oldState.doc,
            [...transactions],
          );
          const changes = getChangedRanges(transform);
          changes.forEach(({ newRange }) => {
            if (newState.doc.resolve(newRange.from).parent.type.spec.code) {
              return;
            }
            const textNodes = findChildrenInRange(
              newState.doc,
              newRange,
              (node) => node.type.isText
            );
            textNodes.forEach(({ node, pos }) => {
              if (!node.text) {
                return;
              }
              const matches = [...node.text.matchAll(emojiRegex())];
              matches.forEach((match) => {
                if (match.index === undefined) {
                  return;
                }
                const emoji = match[0];
                const name = emojiToShortcode(emoji);
                if (!name) {
                  return;
                }
                const from = tr.mapping.map(pos + match.index);
                if (newState.doc.resolve(from).parent.type.spec.code) {
                  return;
                }
                const to = from + emoji.length;
                const emojiNode = this.type.create({ name });
                tr.replaceRangeWith(from, to, emojiNode);
                tr.setStoredMarks(newState.doc.resolve(from).marks());
              });
            });
          });
          if (!tr.steps.length) {
            return;
          }
          return tr;
        },
      }),
    ];
  },
});

export default LazyEmoji;
