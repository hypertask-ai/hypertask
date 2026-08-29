import styles from "@/styles/tiptap.module.scss";
import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import { currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import { useContext, useState } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { SmilePlus } from "lucide-react";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import Tooltip from "@/components/Common/Tooltip";
import EmojiComponent from "../../../CommentAndDescription/CommentContainer/EmojiComponent";

const SharedCommentReactions = () => {
  const { comment, i, emojiFinder } = useCommentsContext();
  const _mbl = useContext(MobileViewContext);
  const { editState } = useTaskContext();

  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);

  const [isHovered, setIsHovered] = useState(false); // State to track hover

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
                emojiClickHandler={() => {}}
                emojiFinder={emojiFinder}
              />
            </>
          )

          // eslint-disable-next-line react/jsx-key
        )}
        <div className="relative  flex">
          <SmilePlus size={14}
            className={`cursor-pointer text-white-black  ml-1 rounded-lg`}
           strokeWidth={1.75}/>
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
                emojiClickHandler={() => {}}
                emojiFinder={emojiFinder}
              />
            </>
          )

          // eslint-disable-next-line react/jsx-key
        )}
        {comment?.reactions && comment?.reactions?.length > 0 && (
          <div className="relative group flex">
            <SmilePlus size={14}
              className="cursor-pointer text-white-black ml-1 rounded-lg  "
              onMouseEnter={() => setIsHovered(true)} // Set isHovered to true on mouse enter
              onMouseLeave={() => setIsHovered(false)}
             strokeWidth={1.75}/>
            {isHovered && (
              <Tooltip
                left={0}
                bottom={-40}
                keyCombination={["R"]}
                text={"Add Reaction"}
              />
            )}
          </div>
        )}
      </div>
    );
  else return <></>;
};

export default SharedCommentReactions;
