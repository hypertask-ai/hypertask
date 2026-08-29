import styles from "@/styles/tiptap.module.scss";

import { BubbleMenu } from "@tiptap/react/menus";
import React, { useState } from "react";
import { buttonConfigs } from "./EditorFormatButtons";
import { ChevronDown } from "lucide-react";
import AIDropdown from "./AIDropdown";
import HighlightButton from "./HighlightButton";

const TiptapBubbleMenu = ({
  currentProjectId,
  currentTaskId,
  toggleHighlight,
  allowPerks,
  editor,
  toggleHighlightHandler,
  hideMenu = false,
}: {
  currentProjectId: number | null | undefined;
  currentTaskId?: number | null;
  toggleHighlight: boolean;
  allowPerks: boolean;
  toggleHighlightHandler: (state: boolean) => void;
  editor: any;
  hideMenu?: boolean;
}) => {
  const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

  const toggleDropdown = () => {
    setDropdownVisible(!isDropdownVisible);
  };

  const isColorActive = (color: string) => {
    return editor?.isActive("highlight", { color }) ?? false;
  };

  const toggleHighlightTrigger = (color: string) => {
    editor?.chain().focus().toggleHighlight({ color }).run();
  };

  const colors = ["#ffc078", "#8ce99a", "#74c0fc", "#b197fc", "#ff0000"];

  if (!editor) return <></>;
  return (
    <>
      {editor && (
        <BubbleMenu
          editor={editor}
          shouldShow={
            hideMenu
              ? undefined
              : ({ editor, view, state, from, to }) => {
                  if (view.dragging || state.selection.empty) return false;

                  return (
                    from !== to &&
                    (editor.isActive("paragraph") || editor.isActive("heading"))
                  );
                }
          }
        >
          {!hideMenu && <div className={` ${styles.floatingmenu}`}>
            {!toggleHighlight ? (
              // ===================== format buttons
              <>
                {buttonConfigs.map((config, index) => {
                  const ButtonComponent = config.component;
                  if (config.id === "HighlightButton") {
                    return (
                      <ButtonComponent
                        key={index}
                        editor={editor}
                        {...config.props}
                        setToggleHighlightbutton={toggleHighlightHandler}
                      />
                    );
                  } else {
                    return (
                      <ButtonComponent
                        key={index}
                        editor={editor}
                        {...config.props}
                        // setToggleHighlightbutton={toggleHighlightHandler}
                      />
                    );
                  }
                })}

                {/* ========================= AI DROPDOWN ===========================  */}
                {allowPerks && (
                  <div className="relative inline-block text-left">
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={toggleDropdown} // Call toggleDropdown on button click
                      className="bg-white t hover:bg-gray-100  font-bold  rounded inline-flex items-center"
                    >
                      <p className="text-[#C668FF]">Ai</p>
                      <ChevronDown size={24} color="#C668FF" strokeWidth={1.75} />
                    </button>
                    {isDropdownVisible && (
                      <AIDropdown
                        currentProjectId={currentProjectId}
                        currentTaskId={currentTaskId}
                        editor={editor}
                        toggleDropdown={toggleDropdown}
                      />
                    )}
                  </div>
                )}
              </>
            ) : (
              // ============================= HIGHLIGHT BUTTONS ==========================
              <>
                <div className="flex items-center">
                  <button onClick={() => toggleHighlightHandler(false)}>
                    Back
                  </button>
                  {colors.map((color) => (
                    <HighlightButton
                      key={color}
                      color={color}
                      isActive={isColorActive(color)}
                      onClick={() => toggleHighlightTrigger(color)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>}
        </BubbleMenu>
      )}
    </>
  );
};

export default TiptapBubbleMenu;
