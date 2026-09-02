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
  const bind = useDoubleTap(handleDoubleTap, 200, {
    onSingleTap: handleSingleTap,
  });

  function handleDoubleTap() {
    if (editState === i) return;
    editCommentHandler(i);
  }
  function handleSingleTap() {
    updateStackedComments(i, true);
    setCurrentId(`comment-${i}`);
  }

  // HTPR-4659: on desktop the native dblclick is the ONLY edit trigger. The
  // useDoubleTap emulator above (mobile) uses a 200ms window, shorter than the
  // browser's, so on desktop it committed the first click as a single tap and
  // the still-live native sequence then opened the editor, reading as "a
  // single click starts edit mode".
  const pressStartRef = useRef({ id: comment.id, collapsed: isStacked, at: 0 });

  function rememberPressStart(event: React.MouseEvent) {
    // Capture phase on mousedown: detail <= 1 is the opening press of a
    // sequence, and children that stopPropagation on click (reply, react, the
    // three-dot menu) never stop mousedown, so this snapshot is never stale.
    if (event.detail <= 1)
      pressStartRef.current = {
        id: comment.id,
        collapsed: isStacked,
        at: event.timeStamp,
      };
  }
  function handleDesktopDoubleClick(event: React.MouseEvent) {
    const pressStart = pressStartRef.current;
    // The virtualized row can be handed a different comment between the two
    // presses; that sequence belongs to the comment that is gone, not this one.
    if (pressStart.id !== comment.id) return;
    // A double click that began on a collapsed comment only expands it: the
    // first click grew the card, so the second one landed on text the user
    // never aimed at.
    if (pressStart.collapsed) return;
    // Two unhurried clicks are two single clicks, whatever the OS says.
    if (event.timeStamp - pressStart.at > DELIBERATE_DOUBLE_CLICK_MS) return;
    handleDoubleTap();
  }
  const isCurrentUserCreator = useMemo(
    () => comment.creator?.id === currentUser?.id,
    [comment.creator?.id, currentUser?.id]
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
        ${isStacked || comment.activity ? "" : " shadow-md "}
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
                  : // not an activity element
                  !isStacked
                  ? `${
                      pinned
                        ? "border-[#FFB980]"
                        : " border-comment-description-border"
                    }  text-white-black bg-comment-description`
                  : "border-transparent hover:bg-active-elementBg "
              }`
        }
        outline-none  comment-container ${
          isStacked || comment.activity ? "my-[4px] cursor-pointer" : "my-[8px]"
        }`}
        key={comment.id}
        tabIndex={i}
        id={`comment-${i}`}
        onMouseDownCapture={rememberPressStart}
        onClick={handleSingleTap}
        onDoubleClick={handleDesktopDoubleClick}
      >
        <Suspense fallback={<>loading...</>}>
          {!comment.activity ? (
            <>
              <CommentBodyDesktop>
                {/* -------------------------- CREATED BY --------------------------- */}
                <CommentCreatedBy />

                {/* -------------------------- COMMENT TEXT -------------------------- */}
                <CommentText />

                {/* -------------------------- COMMENT OPTIONS (reactions + createdAt) --------------------------- */}
                <CommentOptions isCurrentUserCreator={isCurrentUserCreator} />

                {/* ================================= reactions ==================== */}
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
    return !comment.activity ? (
      <div {...bind} className={`py-1`} id={`comment-${comment.id}`}>
        {isFirstNewComment ? (
          <div className="flex items-center gap-2 px-1 pb-1 pt-2 text-micro font-semibold uppercase text-amber-500">
            <div className="h-px flex-1 border-t border-amber-500/45" />
            <span>{newCommentIds.length} NEW</span>
            <div className="h-px flex-1 border-t border-amber-500/45" />
          </div>
        ) : null}
        <CommentCreatedBy />
        <SwipeableCommentRow
          onMore={() => {
            // Select the swiped comment first: the menu labels come from
            // commentIndex, but the action handlers resolve their target from
            // currentId. Without this, actions (incl. delete) would hit the
            // previously selected comment.
            setCurrentId(`comment-${i}`);
            setShowCommands({
              show: true,
              mode: CommandMode.Command,
              commentIndex: i,
            });
          }}
        >
          <div
            className={`
                        rounded-sm
                        ${styles.hellow}
                        ${
                          comment.creator?.id === currentUser?.id
                            ? "bg-self-comment"
                            : // they look the same now but wasn't always t
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
        </SwipeableCommentRow>
      </div>
    ) : (
      <CommentTaskActivity />
    );
  }
};

export default CommentsContainer;
