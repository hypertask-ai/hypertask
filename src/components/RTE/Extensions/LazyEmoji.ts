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

function isFullEmojiSequence(text: string): boolean {
  if (!text) return false;
  return text.replace(emojiRegex(), "").length === 0;
}

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
