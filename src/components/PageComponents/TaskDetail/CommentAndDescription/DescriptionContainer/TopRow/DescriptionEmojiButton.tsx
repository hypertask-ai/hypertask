import { SmilePlus } from "lucide-react";
import styles from "@/styles/tiptap.module.scss";
import { useContext, useEffect, useRef, useState } from "react";
import { LazyEmojiPicker, preloadEmojiResources } from "@/utils/emojiLoader";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { debounce } from "@/utils/helperFunctions/helperFunctions";
import Tooltip from "@/components/Common/Tooltip";
import CommentEmojiTooltip from "../../CommentContainer/CommentEmojiTooltip";
import MobileEmojiReactionSheet from "../../Common/MobileEmojiReactionSheet";
import { createPortal } from "react-dom";
import { getFixedOverlayPosition } from "@/lib/emojiPickerPosition";
// ===================================== COMMENT OPTIONS COMPONENTS =======================
const DescriptionEmojiButton = ({
  handleClickOutside,
  emojiClickHandler,
  toggleEmojiPicker,
  showEmojiPickerDescription,
}: {
  showEmojiPickerDescription: boolean;
  emojiClickHandler: (emojiData: any, event: any, commentId?: number) => void;
  handleClickOutside: (e: any) => void;
  toggleEmojiPicker: () => void;
}) => {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [positionClass, setPositionClass] = useState<
    "top-auto bottom-[16px]" | "bottom-auto top-[16px]"
  >("bottom-auto top-[16px]"); // Default position class for emojis
  const { currentId } = useTaskContext();
  const isMbl = useContext(MobileViewContext);

  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const buttonTrigger = useRef<HTMLDivElement | null>(null);

  const calculatePickerPosition = () => {
    if (buttonTrigger.current) {
      const rect = buttonTrigger.current.getBoundingClientRect();
      // Escape the comment column stacking context via #portal-root + fixed
      // coords so the picker clears the new comment field (HTPR-6404).
      setPickerPosition(
        getFixedOverlayPosition(rect, {
          height: 370,
          width: 300,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        }),
      );
    }
  };

  // =========================== adjust position of the emoji component
  useEffect(() => {
    const debouncedUpdatePosition = debounce(calculatePickerPosition, 20);
    const containerElement = document.getElementById(
      "taskInfo_comments_description_container"
    );
    debouncedUpdatePosition();

    if (containerElement) {
      debouncedUpdatePosition();
      containerElement.addEventListener("scroll", debouncedUpdatePosition);
      window.addEventListener("resize", debouncedUpdatePosition);
    }

    return () => {
      if (containerElement) {
        containerElement.removeEventListener("scroll", debouncedUpdatePosition);
      }
      window.removeEventListener("resize", debouncedUpdatePosition);
    };
  }, []); // Run only once on mount

  useEffect(() => {
    return () => {
      // When THIS Comment component unmounts, ensure its emoji picker is hidden.
      // This prevents the portal from lingering in the DOM.
      // We check if the currently shown picker belongs to this commentId
      // before attempting to hide it.
      handleClickOutside(undefined);
    };
  }, []);

  return (
    <>
      {showEmojiPickerDescription &&
        (isMbl ? (
          // Keyboard-docked, search-first bottom sheet on mobile (HTPR-4589);
          // the floating popup could not raise the keyboard. emojiClickHandler
          // applies the reaction and closes the picker.
          <MobileEmojiReactionSheet
            onEmojiSelect={debounce(emojiClickHandler, 10)}
            onClose={() => handleClickOutside(undefined)}
          />
        ) : (
          createPortal(
            <div // This is your .emoji-picker-wrapper equivalent
              className="emoji-picker-portal-container" // Use a more descriptive class name
              // Picker lives on #portal-root (HTPR-6404). Still stop clicks so a
              // stray bubble cannot count as a description double-tap edit
              // (HTPR-4663).
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                top: pickerPosition.top,
                left: pickerPosition.left,
                zIndex: 9999,
              }}
            >
              {/* The absolute positioned div that holds the picker */}
              <div
                className={`absolute left-0 z-50`} // z-50 from Tailwind should be high enough if zIndex on parent is 9999
                ref={pickerRef} // If you need a ref on this internal div
              >
                <LazyEmojiPicker
                  perLine={6}
                  onClickOutside={handleClickOutside}
                  showPreview={false}
                  previewPosition={"none"}
                  skinTonePosition="none"
                  emojiSize={14}
                  enableFrequentEmojiSort={true}
                  // categories={["frequent","activity","people","objects"]}
                  showCloseButton={false}
                  autoFocus={true}
                  onEmojiSelect={debounce(emojiClickHandler, 10)}
                />
              </div>
            </div>,
            document.getElementById("portal-root")!
          )
        ))}
      <div className="relative group" ref={buttonTrigger}>
        <SmilePlus size={14}
          id="add-reaction-button"
          className={`cursor-pointer
              text-white-black text-emphasis 
            sm:text-icon-dark-gray sm:hover:text-white-black
            transition-transform ease-in-out duration-100
            ${
              currentId === descriptionContainerId
                ? "sm:scale-100"
                : "sm:scale-0"
            }
              sm:group-hover/descriptionContainer:scale-100  
              rounded-lg `}
          onClick={(e) => {
            // Keep the emoji open gesture out of the description double-tap
            // edit counter (HTPR-4663).
            e.stopPropagation();
            toggleEmojiPicker();
            calculatePickerPosition();
          }}
         strokeWidth={1.75}/>
        <CommentEmojiTooltip />
      </div>
    </>
  );
};

export default DescriptionEmojiButton;
