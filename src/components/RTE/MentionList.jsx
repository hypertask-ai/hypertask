import { showMentionListAtom } from "@/store";
import { FileText } from "lucide-react";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useRecoilState } from "@/lib/state";
import { mentionAttrsForItem } from "./mentionAttrs";
import {
  firstSelectableMentionIndex,
  nextSelectableMentionIndex,
  NON_SELECTABLE_MENTION_TYPES,
} from "./mentionNavigation";

const MentionList = forwardRef((props, ref) => {
  const ignoreItems = NON_SELECTABLE_MENTION_TYPES;
  const [selectedIndex, setSelectedIndex] = useState(() =>
    firstSelectableMentionIndex(props.items ?? []),
  );
  const [___, setShowMentionList] = useRecoilState(showMentionListAtom);
  const [isLoading, setIsLoading] = useState(true);
  const [shouldHide, setShouldHide] = useState(false);
  const touchGestureRef = useRef(null);

  // --- HELPER FUNCTIONS ---
  const selectItem = (index) => {
    const item = props.items[index];
    if (item && !ignoreItems.includes(item.type)) {
      props.command(mentionAttrsForItem(item));
    }
  };

  const scrollToIndex = (index) => {
    document.getElementById(`mention-button-${index}`)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  };

  // --- KEYDOWN HANDLERS ---
  const upHandler = () => {
    const nextIndex = nextSelectableMentionIndex(
      props.items,
      selectedIndex,
      -1,
    );
    if (nextIndex < 0) return;
    setSelectedIndex(nextIndex);
    scrollToIndex(nextIndex);
  };

  const downHandler = () => {
    const nextIndex = nextSelectableMentionIndex(
      props.items,
      selectedIndex,
      1,
    );
    if (nextIndex < 0) return;
    setSelectedIndex(nextIndex);
    scrollToIndex(nextIndex);
  };

  const enterHandler = () => selectItem(selectedIndex);
  const pointerSelectHandler = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    // Touch selection waits for touchend so the popup still owns the full
    // gesture and can suppress its compatibility click before unmounting.
    if (event.pointerType !== "touch") selectItem(index);
  };
  const touchStartHandler = (event) => {
    const touch = event.touches[0];
    touchGestureRef.current = touch
      ? { x: touch.clientX, y: touch.clientY, moved: false }
      : null;
  };
  const touchMoveHandler = (event) => {
    event.stopPropagation();
    const gesture = touchGestureRef.current;
    const touch = event.touches[0];
    if (
      gesture &&
      touch &&
      (Math.abs(touch.clientX - gesture.x) > 8 ||
        Math.abs(touch.clientY - gesture.y) > 8)
    ) {
      gesture.moved = true;
    }
  };
  const touchSelectHandler = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    const isTap = touchGestureRef.current?.moved === false;
    touchGestureRef.current = null;
    if (isTap) selectItem(index);
  };
  const touchCancelHandler = () => {
    touchGestureRef.current = null;
  };

  // --- CONSOLIDATED USEEFFECT ---
  useEffect(() => {
    // Check if we should hide the mention list
    if(shouldHide) {
      setIsLoading(false)
      setShowMentionList(false)
      return;
    }
    const shouldHideMentionList = Array.isArray(props.items) &&
      props.items.length === 1 &&
      props.items[0]?.type === "hide" &&
      props.items[0]?.name === "hiding mention list";

    if (shouldHideMentionList) {
      setShouldHide(true);
      return;
    }

    setShowMentionList(true);

    // On small screens, prevent background page scroll while the mention list is open
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
    const previousOverflow = typeof document !== "undefined" ? document.body.style.overflow : undefined;
    if (isMobile && typeof document !== "undefined") {
      document.body.style.overflow = "hidden";
    }

    // If items haven't arrived yet for the current query, stay in a loading state.
    if (!props.items || props.items.length === 0) {
      setIsLoading(true);
    } else {
      // Once items arrive, stop loading.
      setIsLoading(false);
      setSelectedIndex(firstSelectableMentionIndex(props.items));
    }

    // Cleanup function to hide the list when the component unmounts or query changes.
    return () => {
      if (isMobile && typeof document !== "undefined") {
        document.body.style.overflow = previousOverflow || "";
      }
      setTimeout(() => setShowMentionList(false), 100);
    };
  }, [props.items, props.query, shouldHide]); // Effect runs when items OR query change.

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (shouldHide) {
        return false;
      }
      
      if (event.key === "ArrowUp") {
        upHandler();
        return true;
      }
      if (event.key === "ArrowDown") {
        downHandler();
        return true;
      }
      if (event.key === "Enter") {
        enterHandler();
        return true;
      }
      if (event.key === "Escape") {
        setShowMentionList(false);
        return true;
      }
      return false;
    },
  }));

  const hasItems = props.items?.length > 4;
  const noResults = hasItems && props.items[0]?.type === "no-results";
  // If the API returns [{ type: "hide", name: "hiding mention list" }], do NOT render anything (empty fragment)
  if(shouldHide) return <></>;

  return (
    <div
      style={{ color: "#777C85", WebkitOverflowScrolling: "touch" }}
      className="mention_container bg-mentionList items w-[280px] text-content sm:w-[500px] border-border-self-comment no-scrollbar scrollbar-none max-h-[min(18rem,calc(100dvh_-_24px))] overflow-y-auto overscroll-contain touch-pan-y touch-manipulation"
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={touchMoveHandler}
    >
      {isLoading ? (
        <div className="item flex items-center gap-2 p-3">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-600"></div>
          <span>Loading mentions...</span>
        </div>
      ) : hasItems && !noResults ? (
        props.items.map((item, index) => (
          <React.Fragment key={index}>
            {ignoreItems.includes(item?.type) && item.count > 0 ? (
              <h1
                className="text-white-black mention_heading"
                id={`mention-button-${index}`}
              >
                {item.name}
              </h1>
            ) : (
              !ignoreItems.includes(item.type) && (
                <button
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`item ${
                    index === selectedIndex
                      ? "bg-[#ececec] dark:bg-active-mentionList"
                      : ""
                  }`}
                  onPointerDown={(e) => pointerSelectHandler(e, index)}
                  onTouchStart={touchStartHandler}
                  onTouchEnd={(e) => touchSelectHandler(e, index)}
                  onTouchCancel={touchCancelHandler}
                  id={`mention-button-${index}`}
                >
                  {(item?.type === "name" || item?.type === "agent") && <span>{item?.name}</span>}
                  {item?.type === "task" && (
                    <div className="block space-x-1 gap-1">
                      <span className="text-icon-dark-gray whitespace-nowrap">
                        {item?.ticketNumber}
                      </span>
                      <span>{item?.name}</span>
                      {item?.status === "Archive" && (
                        <span className="text-white-black">(archived)</span>
                      )}
                    </div>
                  )}
                  {item?.type === "page" && (
                    <>
                      <FileText
                        className="h-4 w-4 shrink-0 text-icon-dark-gray"
                        aria-hidden="true"
                      />
                      <span className="truncate">{item?.name}</span>
                      {item?.ticketNumber && (
                        <span className="ml-auto pl-2 text-icon-dark-gray whitespace-nowrap">
                          {item?.ticketNumber}
                        </span>
                      )}
                    </>
                  )}
                  {item?.type === "project" && (
                    <div className="block space-x-1 gap-1">
                      {item.uniqueIdentifier?.length > 0 && (
                        <span className="text-icon-dark-gray whitespace-nowrap">
                          {item.uniqueIdentifier}
                        </span>
                      )}
                      <span>{item.name}</span>
                    </div>
                  )}
                </button>
              )
            )}
          </React.Fragment>
        ))
      ) : (
        <div className="item p-3 text-gray-500">No results found</div>
      )}
    </div>
  );
});

MentionList.displayName = "MentionList";

export default MentionList;
