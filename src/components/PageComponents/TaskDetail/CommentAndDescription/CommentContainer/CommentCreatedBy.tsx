// import { useAuth } from '@/hooks/General/useAuth';
import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import { currentUserAtom } from "@/store";
import RelativeTime from "@/components/Common/RelativeTime";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import { useRecoilState } from "@/lib/state";
import CreatedBy from "../Common/CreatedBy";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import styles from "@/styles/tiptap.module.scss";

const NewCommentDot = () => (
  <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-amber-500" />
);

const CommentCreatedBy = () => {
  const _mbl = useContext(MobileViewContext);
  const { comment, isStacked, starred, pinned } = useCommentsContext();
  const { newCommentIds, currentTask } = useTaskContext();
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);

  const displayName = comment.agent?.displayName ?? comment.creator?.displayName ?? "";
  const photoURL = comment.agent?.photoURL ?? comment.creator?.photoURL ?? "";
  const isNewComment = newCommentIds.includes(Number(comment.id));
  const subject = comment.agent
    ? { kind: "agent" as const, id: comment.agent.id }
    : comment.creator
      ? { kind: "user" as const, id: comment.creator.id }
      : null;

  // -------------------- MOBILE
  if (_mbl) {
    return (
      <div
        className={`
            grid
            ${comment.creator?.id === currentUser?.id && "justify-end"}
          `}
      >
        <span className="text-meta text-[#8E9093] flex gap-1 items-center">
          {isNewComment && !starred && !pinned ? <NewCommentDot /> : null}
          <CreatedBy
            pfp={photoURL}
            name={displayName}
            isStacked={isStacked}
            saved={starred}
            publicSave={pinned}
            projectId={currentTask?.projectId}
            subject={subject}
          />
          , <RelativeTime date={comment.createdAt} />
        </span>
      </div>
    );
  }

  // -------------------- DESKTOP
  else
    return (
      <div className={`flex items-center gap-1 ${styles.unstacked_grid_row1}`}>
        {isNewComment && !starred && !pinned ? <NewCommentDot /> : null}
        <CreatedBy
          pfp={photoURL}
          name={displayName}
          isStacked={isStacked}
          saved={starred}
          publicSave={pinned}
          projectId={currentTask?.projectId}
          subject={subject}
        />
      </div>
    );
};

export default CommentCreatedBy;
