import styles from "@/styles/tiptap.module.scss";
import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import EmojiComponent from "./EmojiComponent";
import { currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import { useContext, useEffect, useRef, useState } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { SmilePlus, ThumbsUp } from "lucide-react";
import { thumbsUpEmoji } from "@/lib/constants/constants";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { debounce } from "@/utils/helperFunctions/helperFunctions";
import { LazyEmojiPicker, preloadEmojiResources } from "@/utils/emojiLoader";
import CommentEmojiTooltip from "./CommentEmojiTooltip";
import MobileEmojiReactionSheet from "../Common/MobileEmojiReactionSheet";
import { createPortal } from "react-dom";

const CommentReactions = () => {
  const {
    comment,
    emojiClickHandler,
    handleClickOutside,
    i,
    emojiFinder,
    emojiTrigger2,
  } = useCommentsContext();
  const { showEmojiPickerAtComment, toggleEmojiPicker } =
    useDescriptionAndCommentsContext();
  const _mbl = useContext(MobileViewContext);
  const { editState, parsedTask: parsed_task, editMode } = useTaskContext();
  const pickerRef = useRef<HTMLDivElement>(null);

  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  const hasLiked = comment?.reactions?.some(
    (r) =>
      r.unified === "1f44d" && r.users?.some((u) => u.id === currentUser?.id)
  );

  const [showHere, setShowHere] = useState<boolean>(false);
  const [isHovered, setIsHovered] = useState(false);
  const localClickOutside = (event: any) => {
    setShowHere(false);
    handleClickOutside(event);
  };
  useEffect(() => {
    if (isHovered) {
      const timer = setTimeout(() => {
        preloadEmojiResources();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isHovered]);

  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const element = document.getElementById("portal-root");
    setPortalRoot(element);
  }, []);

  const calculatePickerPosition = () => {
    if (emojiTrigger2.current) {
      const rect = emojiTrigger2.current.getBoundingClientRect();
      const pickerHeight = 370;

      if (_mbl) {
        // Viewport-clamped coords for a position:fixed portal. Document-based
        // (absolute + scrollY) placement below the last comment grows the page
        // on every scroll recalc, making it endlessly scrollable (HTPR-4584).
        // 250: the mobile max-height emojipicker.scss puts on em-emoji-picker.
        const mblPickerHeight = 250;
        const pickerWidth = 300;
        setPickerPosition({
          top: Math.max(
            8,
            Math.min(rect.bottom + 4, window.innerHeight - mblPickerHeight - 8)
          ),
          left: Math.max(
            8,
            Math.min(rect.left, window.innerWidth - pickerWidth - 8)
          ),
        });
        return;
      }

      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

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
    // Desktop only: the mobile picker is now the fixed MobileEmojiReactionSheet,
    // which needs no scroll/resize repositioning (and dismisses via its own
    // backdrop), so no window listeners are attached on mobile.
    if (_mbl) return;

    const debouncedUpdatePosition = debounce(calculatePickerPosition, 100);
    const onScroll = () => debouncedUpdatePosition();

    window.addEventListener("resize", debouncedUpdatePosition);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", debouncedUpdatePosition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [_mbl]);

  useEffect(() => {
    // Desktop only: the mobile sheet is docked and ignores pickerPosition.
    if (_mbl) return;
    if (
      showEmojiPickerAtComment?.show &&
      showEmojiPickerAtComment?.commentId === i
    ) {
      setTimeout(() => {
        calculatePickerPosition();
      }, 100);
    }
  }, [showEmojiPickerAtComment?.show, showEmojiPickerAtComment?.commentId, i, _mbl]);

  //This can be severely improved. SEVERELY
  // ============================== MOBILE
  if (_mbl) {
    if (editState === i) return <></>;
    return (
      <div
        className={`flex items-center gap-1 flex-wrap ${styles.unstacked_grid_row3}`}
      >
        {comment?.reactions?.map(
          (reaction, index) => (
            <>
              <EmojiComponent
                commentId={parseInt(comment.id)}
                currentUser={currentUser}
                initialCount={reaction.count}
                reaction={reaction}
                emojiClickHandler={debounce(emojiClickHandler, 10)}
                emojiFinder={emojiFinder}
              />
            </>
          )

          // eslint-disable-next-line react/jsx-key
        )}
        <div
          className="relative flex items-center gap-1"
          ref={emojiTrigger2}
        >
          {!hasLiked && (
            <ThumbsUp size={14}
              className="cursor-pointer text-white-black rounded-lg"
              onClick={() =>
                emojiClickHandler(
                  thumbsUpEmoji,
                  undefined,
                  parseInt(comment.id)
                )
              }
             strokeWidth={1.75}/>
          )}
          <SmilePlus size={14}
            className={`cursor-pointer text-white-black  ml-1 rounded-lg`}
            onClick={() => toggleEmojiPicker(i)}
           strokeWidth={1.75}/>
          {showEmojiPickerAtComment?.show &&
            showEmojiPickerAtComment?.commentId === i && (
              // Keyboard-docked, search-first bottom sheet (HTPR-4589) — the old
              // fixed popup could not raise the keyboard, so type-to-search was
              // dead. The sheet portals itself; emojiClickHandler applies the
              // reaction and closes.
              <MobileEmojiReactionSheet
                onEmojiSelect={debounce(emojiClickHandler, 10)}
                onClose={() => handleClickOutside(undefined)}
              />
            )}
        </div>
      </div>
    );
  }

  // ============================ DESKTOP
  else if (comment?.reactions && comment?.reactions?.length > 0)
    return (
      <div
        className={`flex items-baseline gap-1 mr-1 ${styles.unstacked_grid_row3}`}
      >
        {comment?.reactions?.map(
          (reaction, index) => (
            <>
              <EmojiComponent
                commentId={parseInt(comment.id)}
                currentUser={currentUser}
                initialCount={reaction.count}
                reaction={reaction}
                emojiClickHandler={debounce(emojiClickHandler, 10)}
                emojiFinder={emojiFinder}
              />
            </>
          )

          // eslint-disable-next-line react/jsx-key
        )}
        {comment?.reactions && comment?.reactions?.length > 0 && (
          <div
            className="relative group flex items-center gap-1"
            ref={emojiTrigger2}
          >
            {!hasLiked && (
              <ThumbsUp size={14}
                className="cursor-pointer text-white-black rounded-lg"
                onClick={() =>
                  emojiClickHandler(
                    thumbsUpEmoji,
                    undefined,
                    parseInt(comment.id)
                  )
                }
               strokeWidth={1.75}/>
            )}
            <SmilePlus size={14}
              className="cursor-pointer text-white-black ml-1 rounded-lg  "
              onClick={() => {
                setShowHere((prev) => !prev);
                calculatePickerPosition();
              }}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
             strokeWidth={1.75}/>
            {showHere &&
              createPortal(
                <div
                  className="emoji-picker-portal-container"
                  style={{
                    position: "absolute",
                    top: pickerPosition.top,
                    left: pickerPosition.left,
                    zIndex: 9999,
                  }}
                >
                  <div className={`absolute left-0 z-50`} ref={pickerRef}>
                    <LazyEmojiPicker
                      onClickOutside={localClickOutside}
                      perLine={7}
                      showPreview={false}
                      previewPosition={"none"}
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
            {isHovered && <CommentEmojiTooltip anchorElement={emojiTrigger2.current} />}
          </div>
        )}
      </div>
    );
  else return <></>;
};

export default CommentReactions;
