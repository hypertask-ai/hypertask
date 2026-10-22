import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { Suspense, useContext, useMemo, useRef } from "react";
import CommentBodyDesktop from "./CommentBodyDesktop";
import CommentCreatedBy from "./CommentCreatedBy";
import styles from "@/styles/tiptap.module.scss";
import AttachmentView from "@/components/Common/AttachmentsView";
import CommentText from "./CommentText";
import dynamic from "next/dynamic";
import { CommentOptions } from "./CommentOptions";
import CommentTaskActivity from "./CommentTaskActivity";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { currentProjectAtom, currentUserAtom, showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { useDoubleTap } from "@/hooks/MultiPages/useDoubleTap";
import { DELIBERATE_DOUBLE_CLICK_MS } from "@/lib/constants/TaskDetail";
import ReplyToComment from "./CommentOptions/ReplyToComment";
import SwipeableCommentRow from "./SwipeableCommentRow";
import { Reply } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7044_DOUBLE_CLICK_TO_EDIT_FLAG } from "@/lib/flags/keys";
import { isTaskDetailEditTarget } from "@/lib/taskDetailEditTarget";
import { isCommentCreatedByUser } from "@/lib/htc/isCommentCreatedByUser";
const CommentReactions = dynamic(() => import("./CommentReactions"));

const CommentReadReceipts = () => {
  const { comment } = useCommentsContext();
  const currentProject = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);

  const seenByNames = useMemo(() => {
    const usersById = new Map(
      [
        currentProject?.owner,
        ...(currentProject?.members ?? []).map((member) => member.user),
        currentUser,
      ]
        .filter((user) => user?.id)
        .map((user) => [user!.id, user!]),
    );
    const authorId = comment.creatorId ?? comment.creator?.id;
    const addedUserIds = new Set<number>();

    return (comment.seen ?? [])
      .filter(
        (userId) =>
          userId !== authorId &&
          userId !== currentUser?.id &&
          !addedUserIds.has(userId),
      )
      .map((userId) => {
        addedUserIds.add(userId);
        return usersById.get(userId)?.displayName?.trim().split(/\s+/)[0];
      })
      .filter((firstName): firstName is string => Boolean(firstName));
  }, [
    comment.creator?.id,
    comment.creatorId,
    comment.seen,
    currentProject?.members,
    currentProject?.owner,
    currentUser,
  ]);

  if (seenByNames.length === 0) return null;

  return (
    <div className="mt-1 text-[12px] text-text-light-gray">
      Seen by {seenByNames.join(", ")}
    </div>
  );
};

const CommentsContainer = () => {
  const { comment, i, isStacked, pinned } = useCommentsContext();
  const { editState, setCurrentId, currentId, setCarousalItems, newCommentIds } =
    useTaskContext();

  const { updateStackedComments, editCommentHandler, replyToCommentHandler } =
    useDescriptionAndCommentsContext();
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  const [, setShowCommands] = useRecoilState(showCommandsAtom);
  const doubleClickToEdit = useFlag(HTPR_7044_DOUBLE_CLICK_TO_EDIT_FLAG);
  const bind = useDoubleTap(handleDoubleTap, 200, {
    onSingleTap: handleSingleTap,
    shouldHandleEvent: doubleClickToEdit
      ? (event) => isTaskDetailEditTarget(event.target, event.currentTarget)
      : undefined,
  });

  function handleDoubleTap() {
    if (editState === i) return;
    editCommentHandler(i);
  }
  function handleSingleTap() {
    updateStackedComments(i, true);
    setCurrentId(`comment-${i}`);
  }

  const pressStartRef = useRef({ id: comment.id, collapsed: isStacked, at: 0, editable: true });

  function rememberPressStart(event: React.MouseEvent) {
    if (event.detail <= 1)
      pressStartRef.current = {
        id: comment.id,
        collapsed: isStacked,
        at: event.timeStamp,
        editable: !doubleClickToEdit || isTaskDetailEditTarget(event.target, event.currentTarget),
      };
  }
  function handleDesktopDoubleClick(event: React.MouseEvent) {
    const pressStart = pressStartRef.current;
    if (doubleClickToEdit && (!pressStart.editable || !isTaskDetailEditTarget(event.target, event.currentTarget))) return;
    if (pressStart.id !== comment.id) return;
    if (pressStart.collapsed) return;
    if (event.timeStamp - pressStart.at > DELIBERATE_DOUBLE_CLICK_MS) return;
    handleDoubleTap();
  }
  const isCurrentUserCreator = useMemo(
    () => isCommentCreatedByUser(comment, currentUser?.id),
    [comment, currentUser?.id]
  );
  const _mbl = useContext(MobileViewContext);
  const commentId = Number(comment.id);
  const isNewComment = newCommentIds.includes(commentId);
  const isFirstNewComment = isNewComment && newCommentIds[0] === commentId;
  if (!currentUser) return <></>;

  if (!_mbl) {
    return (
      <>
      {isFirstNewComment ? (
        <div className="flex items-center gap-2 px-3 py-1 text-micro font-semibold uppercase text-amber-500">
          <div className="h-px flex-1 border-t border-amber-500/45" />
          <span>{newCommentIds.length} NEW</span>
          <div className="h-px flex-1 border-t border-amber-500/45" />
        </div>
      ) : null}
      <div
        className={`
        border-l-4 rounded
        ${isStacked || comment.activity ? "" : " shadow-md bg-comment-description "}
        ${
          currentId === `comment-${i}` || currentId === `comment-${i}-input`
            ? `${
                editState === i
                  ? `border-[#C2CFA5]`
                  : `border-selected-item-border ${
                      isStacked || comment.activity ? "bg-active-elementBg" : ""
                    }`
              }  `
            : `${
                comment.activity
                  ? "border-transparent hover:bg-active-elementBg"
                  :
                  !isStacked
                  ? `${
                      pinned
                        ? "border-[#FFB980]"
                        : " border-comment-description-border"
                    }  text-white-black`
                  : "border-transparent hover:bg-active-elementBg "
              }`
        }
        outline-none  comment-container ${
          !isStacked && !comment.activity
            ? "comment-separation-card"
            : ""
        } ${
          isStacked || comment.activity ? "my-[4px] cursor-pointer" : "my-[8px]"
        }`}
        key={comment.id}
        tabIndex={i}
        id={`comment-${i}`}
        data-testid="ticket-comment"
        data-task-comment-box={!comment.activity || undefined}
        data-task-comment-collapsed={isStacked || undefined}
        data-task-comment-state={
          comment.activity
            ? undefined
            : currentId === `comment-${i}` || currentId === `comment-${i}-input`
            ? "active"
            : pinned && !isStacked
            ? "pinned"
            : undefined
        }
        onMouseDownCapture={rememberPressStart}
        onClick={handleSingleTap}
        onDoubleClick={handleDesktopDoubleClick}
      >
        <Suspense fallback={null}>
          {!comment.activity ? (
            <>
              <CommentBodyDesktop>
                <CommentCreatedBy />

                <CommentText />

                <CommentOptions isCurrentUserCreator={isCurrentUserCreator} />

                {!isStacked && <CommentReactions />}
                {!isStacked && <CommentReadReceipts />}
              </CommentBodyDesktop>

              {!isStacked && comment.attachments && (
                <AttachmentView
                  active={
                    currentId === `comment-${i}` ||
                    currentId === `comment-${i}-input`
                  }
                  attachments={comment.attachments}
                  setCarousalItems={setCarousalItems}
                  compact={false}
                />
              )}
            </>
          ) : (
            <CommentTaskActivity />
          )}
        </Suspense>
      </div>
      </>
    );
  } else {
    const openCommentCommands = () => {
      setCurrentId(`comment-${i}`);
      setShowCommands({
        show: true,
        mode: CommandMode.Command,
        commentIndex: i,
      });
    };
    const commentBubble = (
      <div
        data-task-comment-box
        className={`
                        rounded-sm
                        ${styles.hellow}
                        comment-separation-card
                        ${
                          isCommentCreatedByUser(comment, currentUser?.id)
                            ? "bg-self-comment"
                            :
                              "bg-comment-description"
                        }`}
      >
        <CommentText />

        {comment.attachments && editState !== i && (
          <AttachmentView
            active={
              currentId === `comment-${i}` ||
              currentId === `comment-${i}-input`
            }
            attachments={comment.attachments}
            setCarousalItems={setCarousalItems}
            compact={true}
          />
        )}

        <div className="flex items-center justify-start gap-2">
          <CommentReactions />
          <Reply size={14}
            className={"text-emphasis mt-2 text-white-black"}
            onClick={() => replyToCommentHandler(i)}
           strokeWidth={1.75}/>
        </div>
        <CommentReadReceipts />
      </div>
    );
    return !comment.activity ? (
      <div {...bind} className={`py-1`} id={`comment-${comment.id}`} data-testid="ticket-comment">
        {isFirstNewComment ? (
          <div className="flex items-center gap-2 px-1 pb-1 pt-2 text-micro font-semibold uppercase text-amber-500">
            <div className="h-px flex-1 border-t border-amber-500/45" />
            <span>{newCommentIds.length} NEW</span>
            <div className="h-px flex-1 border-t border-amber-500/45" />
          </div>
        ) : null}
        <CommentCreatedBy />
        <SwipeableCommentRow onMore={openCommentCommands}>
          {commentBubble}
        </SwipeableCommentRow>
      </div>
    ) : (
      <CommentTaskActivity />
    );
  }
};

export default CommentsContainer;
