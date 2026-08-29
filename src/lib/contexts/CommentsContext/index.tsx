import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
} from "react";
import { IComment, IReaction } from "@/models/model";
import { useTaskContext } from "../TaskDetail/TaskProvider";
import { currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import axios, { AxiosResponse } from "axios";
import { useDescriptionAndCommentsContext } from "../TaskDetail/DescriptionProvider";
import { LIKESHORTCUTEVENT, thumbsUpEmoji } from "@/lib/constants/constants";

interface CommentProviderProps {
  children?: ReactNode; // Add this line to include children
  comment: IComment;
  isStacked: boolean;
  i: number;
}
interface CommentsContextProps {
  children?: ReactNode; // Add this line to include children
  returnFocusToComment: () => void;
  updateCommentsOnReaction: (
    response: AxiosResponse<any, any>,
    commentId_: number,
    emojiData: any
  ) => void;
  emojiClickHandler: (
    emojiData: any,
    event: any,
    commentId?: number
  ) => Promise<void>;
  handleClickOutside: (event: any) => void;
  comment: IComment;
  i: number;
  isStacked: boolean;
  emojiFinder: (unicodeValue: any) => any;
  starred: boolean;
  pinned: boolean;
  emojiTrigger: React.MutableRefObject<HTMLDivElement | null>;
  emojiTrigger2: React.MutableRefObject<HTMLDivElement | null>;
}

const CommentsContext = createContext<CommentsContextProps | undefined>(
  undefined
);

const CommentsProvider: React.FC<CommentProviderProps> = ({
  children,
  ...props
}) => {
  const hookProps = useHook(props.comment, props.i);

  const exportThis = {
    ...props,
    ...hookProps,
  };

  return (
    <CommentsContext.Provider value={exportThis}>
      {children}
    </CommentsContext.Provider>
  );
};

const useCommentsContext = () => {
  const context = useContext(CommentsContext);
  if (!context) {
    throw new Error(
      "useCommentsContext must be used within a CommentsProvider"
    );
  }
  return context;
};

export { CommentsProvider, useCommentsContext };

const useHook = (comment: IComment, i: number) => {
  const { setEditState, focusOn, currentTask, currentId, setEditMode } =
    useTaskContext();
  const {
    comments,
    updateStackedComments,
    setShowEmojiPickerAtCount,
    setComments,
    emojiFinder,
  } = useDescriptionAndCommentsContext();
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  const [emojiBreak, setEmojiBreak] = useState(false);
  const [starred, setStarred] = useState(false);
  const [pinned, setPinned] = useState(false);
  const _mbl = useContext(MobileViewContext);
  const emojiTrigger = useRef<HTMLDivElement | null>(null);
  const emojiTrigger2 = useRef<HTMLDivElement | null>(null);

  const updateCommentsOnReaction = (
    response: AxiosResponse<any, any>,
    commentId_: number,
    emojiData: any
  ) => {
    if (response.status === 200 || response.status === 202) {
      const updatedComments = comments.map((comment) => {
        if (parseInt(comment.id) === commentId_) {
          const unifiedExists = comment?.reactions?.some(
            (reaction) => reaction.unified === response.data.unified
          );

          if (response.status === 200) {
            // Handling 200 status - update or add reaction
            if (unifiedExists) {
              // Update existing reaction
              const newReactions = comment?.reactions?.map((reaction) => {
                if (reaction.unified === response.data.unified) {
                  return {
                    ...reaction,
                    count: reaction.count + 1,
                    users: [...reaction.users, response.data.user],
                  };
                }
                return reaction;
              });

              return { ...comment, reactions: newReactions };
            } else {
              // Add new reaction
              const newReaction = {
                id: response.data.id,
                emoji: response.data.emoji,
                count: 1,
                unified: response.data.unified,
                users: [response.data.user],
              };

              return {
                ...comment,
                reactions: [...(comment?.reactions ?? []), newReaction],
              };
            }
          } else if (response.status === 202) {
            // Handling 204 status - reduce count or remove reaction
            const newReactions: IReaction[] | undefined = (
              comment?.reactions ?? []
            )
              .map((reaction) => {
                if (reaction && reaction.unified === emojiData.unified) {
                  const newCount = Math.max(0, reaction.count - 1);
                  const newUsers =
                    newCount === 0
                      ? []
                      : reaction.users.filter(
                          (user) => user.id !== currentUser.id
                        );

                  return newCount === 0
                    ? null
                    : { ...reaction, count: newCount, users: newUsers };
                }
                return reaction;
              })
              .filter((reaction): reaction is IReaction => reaction !== null);

            return { ...comment, reactions: newReactions?.filter(Boolean) }; // Filter out null or undefined
          }
        }

        return comment; // Keep other comments unchanged
      });

      setComments(updatedComments);
    }
    setEmojiBreak(false);
  };

  // ---------------------- return focus to comment
  const returnFocusToComment = () => {
    const extractedId = currentId.replace("-input", ""); // Remove the "-input" part
    focusOn(extractedId);
  };

  // ------------------ onEmojiClick Handler
  const emojiClickHandler = async (
    emojiData: any,
    event: any,
    commentId?: number,
    fastLikeId?: string
  ) => {
    setShowEmojiPickerAtCount(undefined);
    if (emojiBreak) return;
    setEmojiBreak(true);
    // Only return focus to the comment input in the emoji-picker flow (no
    // target passed). On a direct fast-like (mouse or keyboard, which pass a
    // commentId/fastLikeId) skip it: returnFocusToComment focuses currentId and
    // scrollIntoView-centers it, yanking the view away from the clicked comment.
    if (!_mbl && !commentId && !fastLikeId) returnFocusToComment();
    let commentId_ = null;
    if (fastLikeId)
      commentId_ = comments[parseInt(fastLikeId.split("-")[1])].id;
    else {
      commentId_ = commentId
        ? commentId
        : comments[parseInt(currentId.split("-")[1])].id;
    }

    const response = await axios.post("/api/comments/addReaction", {
      commentId: parseInt(commentId_.toString()),
      taskId: currentTask?.id,
      userId: currentUser.id,
      unified: emojiData.unified,
      emoji: emojiData.emoji ?? emojiData.native,
      names: emojiData.keywords ?? [],
    });

    updateCommentsOnReaction(
      response,
      parseInt(commentId_.toString()),
      emojiData
    );
  };
  const handleClickOutside = (event: any) =>
    setShowEmojiPickerAtCount(undefined);

  useEffect(() => {
    if (comment.savedContent && comment.savedContent.length > 0) {
      const starredFound = comment.savedContent.find(
        (item) => item.type === "Private"
      )
        ? true
        : false;
      const pinnedFound = comment.savedContent.find(
        (item) => item.type === "Public"
      )
        ? true
        : false;
      setStarred(starredFound);
      setPinned(pinnedFound);
    } else {
      setStarred(false);
      setPinned(false);
    }
  }, [comment.savedContent]);

  async function handleFastLike(currentId: any) {
    if (!comment.activity && currentId === `comment-${i}`)
      await emojiClickHandler(thumbsUpEmoji, undefined, undefined, currentId);
  }

  useLayoutEffect(() => {
    const handleEventTrigger = (event: CustomEvent) => {
      handleFastLike(event.detail.currentId);
    };

    window.addEventListener(
      LIKESHORTCUTEVENT,
      handleEventTrigger as EventListener
    );
    return () =>
      window.removeEventListener(
        LIKESHORTCUTEVENT,
        handleEventTrigger as EventListener
      );
  }, [comments, currentId]);

  return {
    returnFocusToComment,
    emojiClickHandler,
    updateCommentsOnReaction,
    handleClickOutside,
    emojiFinder,
    starred,
    pinned,
    emojiTrigger,
    emojiTrigger2,
  };
};
