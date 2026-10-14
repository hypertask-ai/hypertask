import { SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { debounce } from "@/utils/helperFunctions/helperFunctions";
import { createPortal } from "react-dom";
import { LazyEmojiPicker, preloadEmojiResources } from "@/utils/emojiLoader";
import CommentEmojiTooltip from "./CommentEmojiTooltip";
import { getFixedOverlayPosition } from "@/lib/emojiPickerPosition";

const EmojiOptionsComp = ({
  showEmojiPickerAtComment,
  handleClickOutside,
  emojiClickHandler,
  i,
  toggleEmojiPicker,
  emojiTrigger,
}: {
  showEmojiPickerAtComment: any;
  emojiClickHandler: (emojiData: any, event: any, commentId?: number) => void;
  handleClickOutside: (e: any) => void;
  toggleEmojiPicker: (commentIndex: number) => void;
  i: number;
  emojiTrigger: React.MutableRefObject<HTMLDivElement | null>;
}) => {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.getElementById("portal-root"));
  }, []);

  const calculatePickerPosition = () => {
    if (emojiTrigger.current) {
      const rect = emojiTrigger.current.getBoundingClientRect();
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
    const debouncedUpdatePosition = debounce(calculatePickerPosition, 100);

    window.addEventListener("resize", debouncedUpdatePosition);
    window.addEventListener("scroll", debouncedUpdatePosition, true);

    return () => {
      window.removeEventListener("resize", debouncedUpdatePosition);
      window.removeEventListener("scroll", debouncedUpdatePosition, true);
    };
  }, []);

  useEffect(() => {
    if (
      showEmojiPickerAtComment?.show &&
      showEmojiPickerAtComment?.commentId === i
    ) {
      setTimeout(() => {
        calculatePickerPosition();
      }, 100);
    }
  }, [showEmojiPickerAtComment, i]);

  useEffect(() => {
    return () => {
      handleClickOutside(undefined);
    };
  }, [i]);

  useEffect(() => {
    if (isHovered) {
      const timer = setTimeout(() => {
        preloadEmojiResources();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isHovered]);
  return (
    <>
      {showEmojiPickerAtComment &&
        portalRoot &&
        createPortal(
          <div
            className="emoji-picker-portal-container"
            style={{
              position: "fixed",
              top: pickerPosition.top,
              left: pickerPosition.left,
              zIndex: 9999,
            }}
          >
            <div
              className={`absolute left-0 z-50`}
              ref={pickerRef}
            >
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
          portalRoot
        )}
      <div className="relative group" ref={emojiTrigger}>
        <SmilePlus size={14}
          id="add-reaction-button"
          className={`cursor-pointer
            text-icon-dark-gray hover:text-white-black
            transition-transform ease-in-out duration-100
            ${
              showEmojiPickerAtComment?.show &&
              showEmojiPickerAtComment?.commentId === i
                ? "scale-100"
                : "scale-0"
            }
              group-hover:scale-100  
              rounded-lg xs:mb-[5px] sm:mb-0`}
          onClick={() => {
            toggleEmojiPicker(i);
            calculatePickerPosition();
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
         strokeWidth={1.75}/>
        {isHovered && <CommentEmojiTooltip anchorElement={emojiTrigger.current} />}
      </div>
    </>
  );
};

export default EmojiOptionsComp;
