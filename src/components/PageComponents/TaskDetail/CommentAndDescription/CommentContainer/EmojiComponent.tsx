import ReactTooltip from "@/components/Common/ReactTooltip";
import { IReaction, IUser } from "@/models/model";
import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import EmojiTooltip from "../Common/EmojiTooltip";
import NativeEmoji from "../Common/NativeEmoji";
import MobileReactorsSheet from "../Common/MobileReactorsSheet";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { createPortal } from "react-dom";

// eslint-disable-next-line react/display-name
const EmojiComponent = memo(
  ({
    commentId,
    initialCount,
    reaction,
    currentUser,
    emojiClickHandler,
    emojiFinder,
  }: {
    commentId: number;
    currentUser: IUser;
    initialCount: number;
    reaction: IReaction;
    emojiClickHandler: (
      emojiData: any,
      event: any,
      commentId?: number
    ) => Promise<void> | any;
    emojiFinder: (unicodeValue: any) => string;
  }) => {
    const _mbl = useContext(MobileViewContext);
    const tooltipTrigger = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false); // State to track hover
    const [showReactors, setShowReactors] = useState(false); // Mobile: who reacted

    const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
    const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
    const emojiData = useMemo(() => emojiFinder(reaction.unified), []);
    const reactors = useMemo(() => {
      if (!reaction?.users?.length) return "";

      const otherUsers: any[] = [];
      let includesCurrentUser = false;

      reaction.users.forEach((user) => {
        if (user.id === currentUser.id) {
          includesCurrentUser = true;
        } else {
          otherUsers.push(user.displayName);
        }
      });

      let temp = "";

      if (otherUsers.length === 0) {
        temp = "You (click to remove)";
      } else if (otherUsers.length === 1) {
        temp = includesCurrentUser ? `${otherUsers[0]} and you` : otherUsers[0];
      } else {
        // Handle cases with more than 5 total users
        if (reaction.users.length > 5) {
          const displayUsers = otherUsers.slice(0, includesCurrentUser ? 4 : 5);
          const remainingCount =
            reaction.users.length -
            displayUsers.length -
            (includesCurrentUser ? 1 : 0);

          temp = includesCurrentUser
            ? `${displayUsers.join(", ")}, you and +${remainingCount}`
            : `${displayUsers.join(", ")} and +${remainingCount}`;
        } else {
          // Original logic for 5 or fewer users
          const lastUser = otherUsers.pop();
          temp = includesCurrentUser
            ? `${otherUsers.join(", ")}, ${lastUser} and you`
            : `${otherUsers.join(", ")} and ${lastUser}`;
        }
      }

      return `${temp}`;
    }, [reaction, currentUser.id]);

    const calculateTooltipPosition = () => {
      if (tooltipTrigger.current) {
        const rect = tooltipTrigger.current.getBoundingClientRect();

        setPickerPosition({
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX + 22.5,
        });
      }
    };

    useEffect(() => {
      const element = document.getElementById("portal-root");
      setPortalRoot(element);
    }, []);

    return (
      <>
        <div
          onClick={(e) => {
            // Mobile has no hover, so a tap surfaces who reacted (via the
            // sheet) instead of toggling; the sheet itself offers "Tap to remove".
            if (_mbl) {
              setShowReactors(true);
              return;
            }
            emojiClickHandler(
              { ...reaction, keyword: reaction.names },
              e,
              commentId
            );
          }}
          className={`cursor-pointer mb-1  relative group
          ${
            reaction?.users?.map((user) => user.id).includes(currentUser.id)
              ? "bg-taskDetailPage"
              : "bg-reactions-others"
          }

          px-2 py-1 text-meta rounded-full w-fit flex items-center
            `}
          onMouseEnter={() => {
            calculateTooltipPosition();
            setIsHovered(true);
          }}
          onMouseLeave={() => setIsHovered(false)}
          ref={tooltipTrigger}
        >
          <NativeEmoji unified={reaction.unified} size={15} />
          <span className="ml-2 text-white-black">{reaction.count}</span>
        </div>

        {_mbl && showReactors && (
          <MobileReactorsSheet
            reaction={reaction}
            currentUser={currentUser}
            semantic={emojiData}
            onRemoveOwn={() =>
              emojiClickHandler(
                { ...reaction, keyword: reaction.names },
                undefined,
                commentId
              )
            }
            onClose={() => setShowReactors(false)}
          />
        )}

        {!_mbl && isHovered &&
          createPortal(
            <div // This is your .emoji-picker-wrapper equivalent
              className="emoji-component-tooltip" // Use a more descriptive class name
              style={{
                position: "absolute", // Position relative to the document body
                top: pickerPosition.top,
                left: pickerPosition.left,
                zIndex: 9999, // Ensure it's on top of everything
              }}
            >
              <div className={`absolute left-0 z-50`}>
                <EmojiTooltip
                  unified={reaction.unified}
                  text={reactors}
                  semantic={emojiData}
                  tooltipClassName="scale-100"
                  setPosition={false}
                />
              </div>
            </div>,
            document.getElementById("portal-root")!
          )}
      </>
    );
  }
);

export default EmojiComponent;
