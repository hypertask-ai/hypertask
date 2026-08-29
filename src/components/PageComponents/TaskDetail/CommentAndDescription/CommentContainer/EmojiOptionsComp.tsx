import { SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { debounce } from "@/utils/helperFunctions/helperFunctions";
import { createPortal } from "react-dom";
import { LazyEmojiPicker, preloadEmojiResources } from "@/utils/emojiLoader";
import CommentEmojiTooltip from "./CommentEmojiTooltip";

// ===================================== COMMENT OPTIONS COMPONENTS =======================
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
  const [isHovered, setIsHovered] = useState(false); // State to track hover

  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const element = document.getElementById("portal-root");
    setPortalRoot(element);
  }, []);

  const calculatePickerPosition = () => {
    if (emojiTrigger.current) {
      const rect = emojiTrigger.current.getBoundingClientRect();
      const pickerHeight = 370; // Approximate height of your emoji picker
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      // Decide whether to show above or below
      const showAbove = spaceBelow < pickerHeight && spaceAbove > pickerHeight;

      setPickerPosition({
        top: showAbove
          ? rect.top + window.scrollY - pickerHeight
          : rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
      });
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

  // Add this useEffect to calculate position when picker opens
  useEffect(() => {
    if (
      showEmojiPickerAtComment?.show &&
      showEmojiPickerAtComment?.commentId === i
    ) {
      // Small delay to ensure the trigger ref is available
      setTimeout(() => {
        calculatePickerPosition();
      }, 100);
    }
  }, [showEmojiPickerAtComment, i]);

  useEffect(() => {
    return () => {
      // When THIS Comment component unmounts, ensure its emoji picker is hidden.
      // This prevents the portal from lingering in the DOM.
      // We check if the currently shown picker belongs to this commentId
      // before attempting to hide it.
      handleClickOutside(undefined);
    };
  }, [i]);

  useEffect(() => {
    if (isHovered) {
      // Start preloading with a slight delay to avoid unnecessary loads
      const timer = setTimeout(() => {
        preloadEmojiResources();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isHovered]);
  return (
    <>
      {showEmojiPickerAtComment &&
        createPortal(
          <div // This is your .emoji-picker-wrapper equivalent
            className="emoji-picker-portal-container" // Use a more descriptive class name
            style={{
              position: "absolute", // Position relative to the document body
              top: pickerPosition.top,
              left: pickerPosition.left,
              zIndex: 9999, // Ensure it's on top of everything
              // Add any other base styling for your picker container
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
                showCloseButton={false}
                autoFocus={true}
                onEmojiSelect={debounce(emojiClickHandler, 10)}
              />
            </div>
          </div>,
          document.getElementById("portal-root")!
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
          onMouseEnter={() => setIsHovered(true)} // Set isHovered to true on mouse enter
          onMouseLeave={() => setIsHovered(false)}
         strokeWidth={1.75}/>
        {isHovered && <CommentEmojiTooltip anchorElement={emojiTrigger.current} />}
      </div>
    </>
  );
};

export default EmojiOptionsComp;
