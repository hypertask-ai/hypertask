import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import styles from "@/styles/tiptap.module.scss";
import RelativeTime from "@/components/Common/RelativeTime";
import dynamic from "next/dynamic";
import { useContext, useMemo, useState } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import TimeTooltip from "@/components/Common/TimeTooltip";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
const EmojiOptionsComp = dynamic(() => import("./EmojiOptionsComp"));
import Tooltip from "@/components/Common/Tooltip";
import { cn } from "@/utils/undoActions/helperFuncs";
import ReplyToComment from "./CommentOptions/ReplyToComment";
import { useRecoilState } from "@/lib/state";
import { showCommandsAtom, currentUserAtom } from "@/store";
import { CommandMode } from "@/models/enums";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { MoreHorizontal, ThumbsUp } from "lucide-react";
import { thumbsUpEmoji } from "@/lib/constants/constants";

export const CommentOptions = ({
  isCurrentUserCreator,
}: {
  isCurrentUserCreator: boolean;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isThumbsHovered, setIsThumbsHovered] = useState(false);
  const isApple = useDeviceContext();
  const [_, setShowCommands] = useRecoilState(showCommandsAtom);
  const [currentUser] = useRecoilState(currentUserAtom);
  const className = useMemo(
    () =>
      "cursor-pointer relative group transition-opacity ease-in-out duration-100 rounded-lg xs:mb-[5px] sm:mb-0",
    []
  );

  const {
    comment,
    i,
    isStacked,
    emojiClickHandler,
    handleClickOutside,
    emojiTrigger,
  } = useCommentsContext();
  const {
    showEmojiPickerAtComment,
    toggleEmojiPicker,
    replyToCommentHandler,
  } = useDescriptionAndCommentsContext();
  const hasLiked = comment?.reactions?.some(
    (r) =>
      r.unified === "1f44d" && r.users?.some((u) => u.id === currentUser?.id)
  );

  return (
    <>
      <div className={`flex items-center gap-2 ${styles.unstacked_grid_row1}`}>
        <ReplyToComment
          currentIndex={i}
          onClickHandler={replyToCommentHandler}
        />

        <EmojiOptionsComp
          handleClickOutside={handleClickOutside}
          emojiClickHandler={emojiClickHandler}
          toggleEmojiPicker={toggleEmojiPicker}
          i={i}
          showEmojiPickerAtComment={
            showEmojiPickerAtComment?.show &&
            showEmojiPickerAtComment?.commentId === i
          }
          emojiTrigger={emojiTrigger}
        />

        {/* Fast Like button — appears on hover, hidden once user has liked */}
        {!hasLiked && (
          <div
            className={cn(
              className,
              " text-icon-dark-gray text-content  hover:text-white-black w-[16px] h-fit  cursor-pointer text-content"
            )}
            onMouseEnter={() => setIsThumbsHovered(true)}
            onMouseLeave={() => setIsThumbsHovered(false)}
          >
            <ThumbsUp size={14}
              className="scale-0 group-hover:scale-100"
              onClick={(e: any) => {
                e.stopPropagation();
                emojiClickHandler(
                  thumbsUpEmoji,
                  undefined,
                  parseInt(comment.id.toString())
                );
              }}
             strokeWidth={1.75}/>
            {isThumbsHovered && (
              <Tooltip
                left={0}
                bottom={-45}
                text="Fast Like"
                keyCombination={["L"]}
              />
            )}
          </div>
        )}

        <div
          className={cn(
            className,
            " text-icon-dark-gray group/options text-content  hover:text-white-black w-[16px] h-fit  cursor-pointer text-content"
          )}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <MoreHorizontal
            size={14}
            strokeWidth={1.75}
            className="scale-0 group-hover:scale-100"
            onClick={() =>
              setShowCommands({
                show: true,
                mode: CommandMode.Command,
                commentIndex: i,
              })
            }
          />
          {isHovered && (
            <Tooltip
              left={-235}
              bottom={-45}
              text="Hypertask Command"
              keyCombination={[`${!isApple ? "CTRL" : "CMD"}`, "K"]}
            />
          )}
        </div>
        <CreatedAtCard stacked={isStacked} createdAt={comment.createdAt} />
      </div>
    </>
  );
};

// ======================= CREATED AT CARD
export const CreatedAtCard = ({
  createdAt,
  stacked,
}: {
  stacked: boolean;
  createdAt: string;
}) => {
  const _mbl = useContext(MobileViewContext);
  const date = new Date(createdAt);
  const [isHovered, setIsHovered] = useState(false); // State to track hover

  return (
    <span
      onMouseEnter={() => setIsHovered(true)} // Set isHovered to true on mouse enter
      onMouseLeave={() => setIsHovered(false)} // Set isHovered to false on mouse leave
      className={`${
        stacked && !_mbl ? "text-content" : "text-meta"
      } whitespace-nowrap text-[#8E9093] relative group`}
    >
      <RelativeTime date={createdAt} />
      {isHovered && <TimeTooltip time={date} left={55} bottom={-5} />}
    </span>
  );
};
