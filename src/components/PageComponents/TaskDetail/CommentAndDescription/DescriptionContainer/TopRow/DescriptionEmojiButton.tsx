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
  >("bottom-auto top-[16px]");
  const { currentId } = useTaskContext();
  const isMbl = useContext(MobileViewContext);

  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const buttonTrigger = useRef<HTMLDivElement | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.getElementById("portal-root"));
  }, []);

  const calculatePickerPosition = () => {
    if (buttonTrigger.current) {
      const rect = buttonTrigger.current.getBoundingClientRect();
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
  }, []);

  useEffect(() => {
    return () => {
      handleClickOutside(undefined);
    };
  }, []);

  const desktopPicker =
    showEmojiPickerDescription && !isMbl && portalRoot
      ? createPortal(
          <div
            className="emoji-picker-portal-container"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pickerPosition.top,
              left: pickerPosition.left,
              zIndex: 9999,
            }}
          >
            <div className="absolute left-0 z-50" ref={pickerRef}>
              <LazyEmojiPicker
                perLine={6}
                onClickOutside={handleClickOutside}
                showPreview={false}
                previewPosition={"none"}
                skinTonePosition="none"
                emojiSize={14}
                enableFrequentEmojiSort={true}
                showCloseButton={false}
                autoFocus={true}
                onEmojiSelect={debounce(emojiClickHandler, 10)}
              />
            </div>
          </div>,
          portalRoot,
        )
      : null;

  return (
    <>
      {showEmojiPickerDescription && isMbl && (
        <MobileEmojiReactionSheet
          onEmojiSelect={debounce(emojiClickHandler, 10)}
          onClose={() => handleClickOutside(undefined)}
        />
      )}
      {desktopPicker}
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
