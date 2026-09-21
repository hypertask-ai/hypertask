import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  CodeXml,
  FileImage,
  Heading1,
  Heading2,
  Highlighter,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Menu,
  Paperclip,
  Quote,
  ImagePlay,
  Smile,
  Underline,
  SquarePlay,
} from "lucide-react";
import { RedirectMode } from "@/models/model";
import toast from "react-hot-toast";
import { TIPTAPUPDATECREATETASK } from "@/lib/constants/constants";
import { tiptapForwardSlashRoute } from "@/lib/constants/APIRouteConstants";
import { OPEN_EMOJI_GIF_PICKER_EVENT } from "../../Components/EmojiGifPicker";
import type { EmojiGifPickerTab } from "../../Components/EmojiGifPicker";

// document.getElementById("create-comment-attachmentUpload")?.click()

interface Command {
  editor: Editor;
  range: any;
  mode: RedirectMode;
  currentProjectId?: number | null;
}

const selectAnDelete = (editor: Editor, range: any) => {
  editor?.chain().focus().deleteRange(range).run();
  editor.commands.selectAll();
};

const openEmojiGifPicker = (
  editor: Editor,
  range: any,
  initialTab: EmojiGifPickerTab
) => {
  // No setParagraph(): emoji/GIFs are inline-ish inserts, converting the block
  // would flatten a list item or heading the user is typing in.
  editor.chain().focus().deleteRange(range).run();
  const position = editor.state.selection.from;
  const coords = editor.view.coordsAtPos(position);

  window.dispatchEvent(
    new CustomEvent(OPEN_EMOJI_GIF_PICKER_EVENT, {
      detail: {
        editor,
        initialTab,
        position,
        anchorRect: {
          bottom: coords.bottom,
          left: coords.left,
          top: coords.top,
        },
      },
    })
  );
};
// Shared runner for the AI slash items that hit our own Flask backend
// (same shape as Fix Grammar / Improve Readability above).
const runFlaskSlash = async (
  editor: Editor,
  range: any,
  command: string,
  currentProjectId: number | null | undefined,
  labels: { loading: string; success: string; error: string }
) => {
  try {
    selectAnDelete(editor, range);
    editor.chain().focus().run();
    const contentToFix = editor.getHTML();
    await toast.promise(
      (async () => {
        const response = await fetch(tiptapForwardSlashRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: contentToFix,
            command,
            projectId: currentProjectId,
          }),
        });
        if (!response.ok) {
          throw new Error("Error during process");
        }
        const data = await response.json();
        const fixedContent = data.corrected_html;
        if (fixedContent) {
          editor.commands.setContent(fixedContent);
        }
        return true;
      })().catch((error) => {
        console.log("🚀 ~ error:", error);
        throw error;
      }),
      {
        loading: labels.loading,
        success: () => {
          editor.commands.focus("end");
          const event = new CustomEvent(TIPTAPUPDATECREATETASK, { detail: {} });
          window.dispatchEvent(event);
          return labels.success;
        },
        error: () => {
          editor.commands.focus("end");
          return labels.error;
        },
      },
      {
        loading: { duration: Infinity },
        success: { duration: 3000 },
        error: { duration: 3000 },
      }
    );
  } catch (error) {
    console.log("🚀 ~ command: ~ error:", error);
    return false;
  }
};
const getSuggestionItems = (query: { query: string; editor: any }) => {
  // The AI chat "/" menu is skills-only: no formatting/AI-editor commands there.
  // Skill items are injected by CommandsList (which has the current board id).
  if (query.editor?.storage?.slashCommands?.mode === "ai-chat") return [];
  return [
    {
      title: "Fix Spelling & Grammer",
      text: "Fix Spelling and grammar",
      icon: Menu,
      type: "AI",
      command: async ({ editor, range, currentProjectId }: Command) => {
        try {
          selectAnDelete(editor, range);
          editor.chain().focus().run();
          const contentToFix = editor.getHTML();

          await toast.promise(
            (async () => {
              const response = await fetch(tiptapForwardSlashRoute, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  content: contentToFix,
                  command: "FixSpellingAndGrammar",
                  projectId: currentProjectId,
                }),
              });

              if (!response.ok) {
                throw new Error("Error during process");
              }

              const data = await response.json();
              const fixedContent = data.corrected_html;

              if (fixedContent) {
                editor.commands.setContent(fixedContent);
              }
              return true;
            })().catch((error) => {
              console.log("🚀 ~ error:", error);
              throw error;
            }),
            {
              loading: "Fixing Spelling and Grammer",
              success: () => {
                editor.commands.focus("end");
                const event = new CustomEvent(TIPTAPUPDATECREATETASK, {
                  detail: {},
                });
                window.dispatchEvent(event);
                return "Fixed Spelling and Grammer";
              },
              error: () => {
                editor.commands.focus("end");
                return "Failed to fix Spelling and Grammer";
              },
            },
            {
              loading: {
                duration: Infinity,
              },
              success: {
                duration: 3000,
              },
              error: {
                duration: 3000,
              },
            }
          );
        } catch (error) {
          console.log("🚀 ~ command: ~ error:", error);
          return false;
        }
      },
    },
    {
      title: "Improve Readability",
      text: "Let AI improve your sentence readability",
      icon: Menu,
      type: "AI",
      command: async ({ editor, range, currentProjectId }: Command) => {
        try {
          selectAnDelete(editor, range);
          editor.chain().focus().run();
          const contentToFix = editor.getHTML();

          await toast.promise(
            (async () => {
              const response = await fetch(tiptapForwardSlashRoute, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  content: contentToFix,
                  command: "ImproveReadability",
                  projectId: currentProjectId,
                }),
              });

              if (!response.ok) {
                return false;
              }

              const data = await response.json();
              const fixedContent = data.corrected_html;

              if (fixedContent) {
                editor.commands.setContent(fixedContent);
              }
              return true;
            })().catch((error) => {
              console.log("🚀 ~ error:", error);
              throw error;
            }),
            {
              loading: "Improving Readability",
              success: () => {
                editor.commands.focus("end");
                const event = new CustomEvent(TIPTAPUPDATECREATETASK, {
                  detail: {},
                });
                window.dispatchEvent(event);
                return "Content Readability Improved";
              },
              error: "Failed to improve readability",
            },
            {
              loading: {
                duration: Infinity,
              },
              success: {
                duration: 3000,
              },
              error: {
                duration: 3000,
              },
            }
          );
        } catch (error) {
          console.log("🚀 ~ command: ~ error:", error);
          return false;
        }
      },
    },
    {
      title: "Summarize",
      text: "Summarize all text with AI",
      icon: Menu,
      type: "AI",
      command: ({ editor, range, currentProjectId }: Command) => {
        runFlaskSlash(editor, range, "Summarize", currentProjectId, {
          loading: "Summarizing",
          success: "Content Summarized",
          error: "Failed to summarize",
        });
      },
    },
    {
      title: "Make Shorter",
      text: "Make the text shorter with AI",
      icon: Menu,
      type: "AI",
      command: ({ editor, range, currentProjectId }: Command) => {
        runFlaskSlash(editor, range, "MakeShorter", currentProjectId, {
          loading: "Making it shorter",
          success: "Made Shorter",
          error: "Failed to shorten",
        });
      },
    },
    {
      title: "Translate to English",
      text: "Translate the text to English",
      icon: Menu,
      type: "AI",
      command: ({ editor, range, currentProjectId }: Command) => {
        runFlaskSlash(editor, range, "Translate:English", currentProjectId, {
          loading: "Translating to English",
          success: "Translated to English",
          error: "Failed to translate",
        });
      },
    },
    {
      title: "Translate to German",
      text: "Translate the text to German",
      icon: Menu,
      type: "AI",
      command: ({ editor, range, currentProjectId }: Command) => {
        runFlaskSlash(editor, range, "Translate:German", currentProjectId, {
          loading: "Translating to German",
          success: "Translated to German",
          error: "Failed to translate",
        });
      },
    },
    {
      title: "File Attachments",
      text: "Upload Attachments",
      icon: Paperclip,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).setParagraph().run();
        setTimeout(() => {
          document
            .getElementById(
              (editor.storage as any).slashCommands.mode + "-" + "attachmentUpload"
            )
            ?.click();
        }, 2);
      },
    },
    {
      title: "Embed Video",
      text: "Add Youtube Video Embed",
      icon: SquarePlay,
      command: ({ editor, range }: Command) => {
        const url = prompt("Enter YouTube URL");
        if (url) editor?.commands.setYoutubeVideo({ src: url });
        editor.chain().focus().deleteRange(range).setParagraph().run();
      },
    },
    {
      title: "Emoji",
      text: "Insert an emoji",
      aliases: ["emoji", "emojis"],
      commentOnly: true,
      icon: Smile,
      command: ({ editor, range }: Command) => {
        openEmojiGifPicker(editor, range, "emoji");
      },
    },
    {
      title: "GIFs",
      text: "Search GIPHY",
      aliases: ["giphy", "gif", "gifs"],
      commentOnly: true,
      icon: ImagePlay,
      command: ({ editor, range }: Command) => {
        openEmojiGifPicker(editor, range, "gifs");
      },
    },
    {
      title: "Heading 1",
      text: "Level 1 Heading",
      icon: Heading1,
      command: ({ editor, range }: Command) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .toggleHeading({ level: 1 })
          .run();
      },
    },
    {
      title: "Heading 2",
      text: "Level 2 Heading",
      icon: Heading2,
      command: ({ editor, range }: Command) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .toggleHeading({ level: 2 })
          .run();
      },
    },
    {
      title: "Highlight",
      text: "Toggle Highlight text",
      icon: Highlighter,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).toggleHighlight().run();
      },
    },
    {
      title: "Add Image",
      text: "Upload Image files",
      icon: FileImage,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).setParagraph().run();
        setTimeout(() => {
          document
            .getElementById(
              (editor.storage as any).slashCommands.mode + "-" + "attachmentUpload"
            )
            ?.click();
        }, 2);
      },
    },
    {
      title: "Bullet List",
      text: "Create a bullet list",
      icon: List,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: "Task List",
      text: "Toggle a task list",
      icon: ListChecks,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run();
      },
    },
    {
      title: "Numbered List",
      text: "Create a numbered list",
      icon: ListOrdered,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      title: "Text",
      text: "Just start typing with plain text.",
      icon: Menu,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).setParagraph().run();
      },
    },
    {
      title: "Bold",
      text: "Bold style text",
      icon: Bold,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).setMark("bold").run();
      },
    },
    {
      title: "Italic",
      text: "Italic style text",
      icon: Italic,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).setMark("italic").run();
      },
    },
    {
      title: "Underline",
      text: "Underline style text",
      icon: Underline,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).setUnderline().run();
      },
    },
    {
      title: "BlockQuote",
      text: "Add BlockQuote",
      icon: Quote,
      command: ({ editor, range }: Command) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run();
      },
    },
    {
      title: "Code",
      text: "Add inline code",
      icon: Code,
      command: ({ editor, range }: Command) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .command(({ commands }) => {
            // Move cursor to the end of the document
            commands.setTextSelection(editor.state.doc.content.size);
            return true;
          })
          .setCode()
          .insertContent(" ")
          .run();
      },
    },
    {
      title: "Code Block",
      text: "Add code block",
      icon: CodeXml,
      command: ({ editor, range }: Command) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .command(({ commands }) => {
            // Move cursor to the end of the document
            commands.setTextSelection(editor.state.doc.content.size);
            return true;
          })
          .insertContent({
            type: "codeBlock",
            attrs: { language: "javascript" },
          })
          .run();
      },
    },
  ].filter(
    (item) =>
      !("commentOnly" in item) ||
      !item.commentOnly ||
      query.editor.storage.slashCommands.mode === "create-comment"
  );
};

export default getSuggestionItems;
