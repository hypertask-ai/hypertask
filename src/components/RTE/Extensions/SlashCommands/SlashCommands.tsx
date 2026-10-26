import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import getSuggestionItems from "./items";
import renderItems from "./RenderCommands";

const SlashCreate = (mode: string, editorId?: string, getProjectId?: () => number | null | undefined) => {
  const SlashCommands = Extension.create({
    name: "slashCommands",

    addOptions() {
      return {
        suggestion: {
          items: getSuggestionItems,
          render: renderItems,
          char: "/",
          startOfLine: false,
          allowedPrefixes: null,
          command: ({ editor, range, props }: any) => {
            props.command({
              editor,
              range,
              props,
              mode,
              currentProjectId: props.currentProjectId,
            });
          },
          mode: mode
        }
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion
        })
      ];
    },

    addStorage() {
      return {
        mode: mode,
        editorId,
        getProjectId
      };
    }
  });

  return SlashCommands;
};

export default SlashCreate;
