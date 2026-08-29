import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { Suspense, useContext, useMemo } from "react";
import styles from "@/styles/tiptap.module.scss";
import AttachmentView from "@/components/Common/AttachmentsView";
import dynamic from "next/dynamic";
const SharedCommentReactions = dynamic(() => import("../../../CommentAndDescription/CommentContainer/CommentReactions"));
import { useRecoilState } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import CommentTaskActivity from "../../../CommentAndDescription/CommentContainer/CommentTaskActivity";
import CommentBodyDesktop from "../../../CommentAndDescription/CommentContainer/CommentBodyDesktop";
import CommentCreatedBy from "../../../CommentAndDescription/CommentContainer/CommentCreatedBy";
import { CreatedAtCard } from "../../../CommentAndDescription/CommentContainer/CommentOptions";
import { useDoubleTap } from "@/hooks/MultiPages/useDoubleTap";
import { desktopCommentContainerClassname } from "@/utils/helperFunctions/TaskDetail/CommentDesktopContainerClsNameGen";
import SharedCommentText from "./CommentText";

const SharedCommentsContainer = () => {
  const { comment, i, isStacked } = useCommentsContext();
  const { editState, setCurrentId, currentId, setCarousalItems } = useTaskContext();

  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  const bind = useDoubleTap(handleDoubleTap, 200, {
    onSingleTap: handleSingleTap,
  });

  function handleDoubleTap() {
    if (editState === i) return;
  }
  function handleSingleTap() {
    setCurrentId(`comment-${i}`);
  }

  const _mbl = useContext(MobileViewContext);
  const commentClasses = desktopCommentContainerClassname({
    isStacked: isStacked,
    isActivity: comment.activity,
    currentId: currentId,
    commentId: i.toString(),
  });

  if (!_mbl) {
    return (
      <div
        {...bind}
        className={commentClasses}
        // className=" my-[8px] outline-none"
        key={comment.id}
        tabIndex={i}
        id={`comment-${i}`}
      >
        <Suspense fallback={<>loading...</>}>
          {!comment.activity ? (
            <>
              {/* ========================== COMMENT ====================================== */}
              <CommentBodyDesktop>
                {/* -------------------------- CREATED BY --------------------------- */}
                <CommentCreatedBy />

                {/* -------------------------- COMMENT TEXT -------------------------- */}
                <SharedCommentText />

                <div
                  className={`flex items-center gap-2 ${styles.unstacked_grid_row1}`}
                >
                  <CreatedAtCard
                    stacked={isStacked}
                    createdAt={comment.createdAt}
                  />
                </div>

                {/* ================================= reactions ==================== */}
              </CommentBodyDesktop>

              {!isStacked && comment.attachments && (
                <>
                  <AttachmentView
                    active={
                      currentId === `comment-${i}` ||
                      currentId === `comment-${i}-input`
                    }
                    attachments={comment.attachments}
                    setCarousalItems={setCarousalItems}
                  />
                </>
              )}
            </>
          ) : (
            // ========================== show task activity
            <CommentTaskActivity />
          )}
        </Suspense>
      </div>
    );
  } else {
    return (
      <>
        {!comment.activity ? (
          <div className={`py-1`} id={`comment-${comment.id}`} {...bind}>
            {/* ------------ comment info container. */}

            {/* -------------------------- CREATED BY --------------------------- */}
            <CommentCreatedBy />
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
              <SharedCommentText />
              {/* ------------ comment text  */}

              {comment.attachments && (
                <AttachmentView
                  active={
                    currentId === `comment-${i}` ||
                    currentId === `comment-${i}-input`
                  }
                  attachments={comment.attachments}
                  setCarousalItems={setCarousalItems}
                />
              )}
            </div>
          </div>
        ) : (
          <CommentTaskActivity />
        )}
      </>
    );
  }
};

export default SharedCommentsContainer;
