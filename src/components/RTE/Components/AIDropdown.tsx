import type { Editor } from "@tiptap/react";
import React from "react";
import toast from "react-hot-toast";
import { TIPTAPUPDATECREATETASK } from "@/lib/constants/constants";
import { translate } from "../constants";
import { tiptapForwardSlashRoute } from "@/lib/constants/APIRouteConstants";

// Same backend + response shape as the forward-slash AI items (items.ts),
// so the bubble menu stays in sync with the slash menu.
const runFlaskCommand = async (
  editor: Editor,
  command: string,
  currentProjectId: number | null | undefined,
  currentTaskId: number | null | undefined,
  labels: { loading: string; success: string; error: string }
) => {
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
          taskId: currentTaskId,
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
};

const AIDropdown = ({
  currentProjectId,
  currentTaskId,
  editor,
  toggleDropdown,
}: {
  currentProjectId: number | null | undefined;
  currentTaskId?: number | null;
  editor: Editor;
  toggleDropdown: () => void;
}) => {
  const run = (
    command: string,
    labels: { loading: string; success: string; error: string }
  ) => {
    toggleDropdown();
    void runFlaskCommand(
      editor,
      command,
      currentProjectId,
      currentTaskId,
      labels,
    );
  };

  const itemClass =
    // !font-normal overrides the inherited `.floatingmenu button { font-weight: 900 }`
    // so the dropdown items render as a normal-weight menu, not chunky faux-bold.
    "w-full text-left px-3 py-2 hover:bg-gray-100 text-black whitespace-nowrap !font-normal";

  return (
    <div className="origin-bottom scrollbar-none flex flex-col absolute justify-start items-start right-0 mt-2 w-56 max-h-72 overflow-y-auto rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
      <button
        // preventDefault keeps the text selection so the bubble menu stays open
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          run("FixSpellingAndGrammar", {
            loading: "Fixing Spelling and Grammer",
            success: "Fixed Spelling and Grammer",
            error: "Failed to fix Spelling and Grammer",
          })
        }
        className={itemClass}
      >
        Fix Spelling &amp; Grammar
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          run("ImproveReadability", {
            loading: "Improving Readability",
            success: "Content Readability Improved",
            error: "Failed to improve readability",
          })
        }
        className={itemClass}
      >
        Improve Readability
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          run("Summarize", {
            loading: "Summarizing",
            success: "Content Summarized",
            error: "Failed to summarize",
          })
        }
        className={itemClass}
      >
        Summarize
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          run("MakeShorter", {
            loading: "Making it shorter",
            success: "Made Shorter",
            error: "Failed to shorten",
          })
        }
        className={itemClass}
      >
        Make Shorter
      </button>
      {translate.map((lang) => (
        <button
          key={lang.code}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            run(`Translate:${lang.name}`, {
              loading: `Translating to ${lang.name}`,
              success: `Translated to ${lang.name}`,
              error: `Failed to translate to ${lang.name}`,
            })
          }
          className={itemClass}
        >
          Translate to {lang.name}
        </button>
      ))}
    </div>
  );
};

export default AIDropdown;
