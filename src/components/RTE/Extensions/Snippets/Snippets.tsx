import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { isForcedSnippetPicker } from "@/lib/snippets";

const SnippetsPluginKey = new PluginKey("snippets");
import getSuggestionItems from "./items";
import renderItems from "./RenderSnippets";

const Snippets = Extension.create({
  name: "snippets",

  addOptions() {
    return {
      suggestion: {
        pluginKey: SnippetsPluginKey,
        char: ";",
        startOfLine: false,
        allowedPrefixes: null,
        items: getSuggestionItems,
        render: renderItems,
        allow: ({ editor, range, state }: any) => {
          if (isForcedSnippetPicker(editor)) return true;
          if (range.from <= 1) return true;
          const previousCharacter = state.doc.textBetween(
            range.from - 1,
            range.from,
            "\n",
            "\0",
          );
          return /\s/.test(previousCharacter);
        },
        command: ({ editor, range, props }: any) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(props.content)
            .run();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

export default Snippets;
