import { useTiptapGlobalContext } from "@/lib/contexts/TaskDetail/TiptapProvider";
import React, { useContext } from "react";
import styles from "@/styles/tiptap.module.scss";
import { EditorContent } from "@tiptap/react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import DragHandleTiptap from "./DragHandleTiptap";

const TiptapEditor = () => {
  const {
    mode,
    editor,
    toggleExpansion,
    toggleHighlightHandler,
    stack,
    isExpanded,
    id,
    isEditable,
  } = useTiptapGlobalContext();
  const isMbl = useContext(MobileViewContext);
  //  const allowedAttachmentModes = ["read-edit-description", "create-comment"]

  const addImage = (data: DataTransfer) => {
    const { files } = data;
    console.log(files);

    if (files && files.length > 0) {
      for (const file of Array.from(files)) {
        const [mime] = file.type.split("/");

        if (mime === "image") {
          const url = URL.createObjectURL(file);
          console.log("IMAGE URL  " + url);
          editor?.chain().focus().setMedia({"media-type":"img", src: url }).run();
        }
      }
    }
  };
  const onDropHandler = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    addImage(e.dataTransfer);
  };

  // =========================================================== MOBILE
  if (isMbl) {
    return (
      <div
        className={`
          w-full min-w-0
          relative
          ${
            mode === "read-edit-description" &&
            "@apply col-[1_/_3] min-h-[78px]"
          }
          scrollbar-none
          ${
            id === "comment-input"
              // text-content (14px): the mobile new-comment branch is the one
              // place that does not get styles.hellow, so .editorContainer's
              // 14px paragraph rule never applies and the composer fell back to
              // the 16px editor base, larger than every other app surface.
              ? `text-content max-h-[80px] flex-1 overflow-y-auto py-[8px]
                focus-within:max-h-[var(--mobile-comment-auto-editor-max-height)]
                has-[.ProseMirror-focused]:max-h-[var(--mobile-comment-auto-editor-max-height)]
                ${editor?.isFocused ? "border-b border-light-black-border-1" : ""}`
              : ""
          }
          ${
            id === "comment-input"
              ? ""
              : "@sm:max-h-full max-w-[85cqw] @sm:max-w-[560px] @md:max-w-full"
          }
          break-normal
          ${styles.editorContainer}
          ${mode === "read-edit-description" && !isEditable ? styles.readOnlyDescription : ""}
          ${mode !== "create-comment" && !stack ? "mt-2" : ""}
           
          ${styles.unstacked}
          `}
        id={`${id}-input`}
        onClick={toggleExpansion}
        onKeyDown={(e) => toggleHighlightHandler(false)}
        tabIndex={stack ? 0 : -1} // Set tabIndex to -1 when stack is false
      >
        {mode === "read-edit-description" && !isEditable && editor?.isEmpty && (
          <div className="pointer-events-none absolute inset-0 z-10 text-[#AEB4BC]">
            <h2 className="text-subheading font-bold">Add Description</h2>
            <p>Tip: Double tap to edit</p>
          </div>
        )}
        {editor ? (
          <EditorContent
            onClick={(e) => !editor?.isFocused && e.stopPropagation()}
            autoFocus={false}
            onDrop={isEditable ? onDropHandler : undefined}
            className=""
            editor={editor}
          />
        ) : (
          <div className="h-[21px]"></div>
        )}
      </div>
    );
  }

  // =========================================================== DESKTOP
  else {
    return (
      <div
        className={`
              transition-all
              w-full
              duration-[40ms]
              ${isMbl && "relative"}
              ${mode === "read-edit-description" && "@apply col-[1_/_3]"}
              scrollbar-none
              ${id === "comment-input" ? "max-h-[80px] overflow-y-auto has-[.ProseMirror-focused]:max-h-full" : ""} 
              @sm:max-h-full max-w-[85cqw] @sm:max-w-[560px] @md:max-w-full break-normal
              ${styles.editorContainer}
              ${mode === "read-edit-description" && !isEditable ? styles.readOnlyDescription : ""}
              ${mode !== "create-comment" && !stack ? "mt-2" : ""}
              ${
                isMbl
                  ? `  ${
                      (isExpanded && id !== "comment") || id !== "comment-input"
                        ? ``
                        : ``
                    } `
                  : ` ${isEditable && styles.readOnly}  `
              } 
              ${mode !== "create-comment" ? "" : ""}  ${
          stack ? styles.stacked : styles.unstacked
        }
              `}
        id={`${id}-input`}
        onClick={toggleExpansion}
        onKeyDown={(e) => toggleHighlightHandler(false)}
        tabIndex={stack ? 0 : -1} // Set tabIndex to -1 when stack is false
      >
        {mode === "read-edit-description" && !isEditable && editor?.isEmpty && (
          <div className="pointer-events-none absolute inset-0 z-10 text-[#AEB4BC]">
            <h2>Add Description</h2>
            <p>Tip: Hit ENTER to edit mode or CTRL+D to jump here</p>
          </div>
        )}
        {editor ? (
          <>
            {isEditable && <DragHandleTiptap editor={editor} />}
            <EditorContent
              onDrop={isEditable ? onDropHandler : undefined}
              className=""
              editor={editor}
            />
          </>
        ) : (
          <div className="h-[21px]"></div>
        )}
      </div>
    );
  }
};

export default TiptapEditor;
