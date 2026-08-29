import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import styles from "@/styles/tiptap.module.scss";
import InnerHTMLComment from "../../../CommentAndDescription/CommentContainer/InnerHTMLComment";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import CollapsedCommentPreview from "../../../CommentAndDescription/CommentContainer/CollapsedCommentPreview";

const SharedCommentText = () => {
  const { comment, isStacked } = useCommentsContext();
  const { setCarousalItems } = useTaskContext();
  const _mbl = useContext(MobileViewContext);

  if (_mbl) {
    return (
      <>
        <InnerHTMLComment
          isStacked={isStacked}
          stackedStyle={
            isStacked
              ? `${styles.stackedComment}`
              : `${styles.unstacked_grid_row2}`
          }
          commentText={comment.text}
          summary={comment.summary}
          id={`comment-${comment.id}-input`}
          commentCreator={comment.creator}
          attachmentsFromParent={comment.attachments}
          setCarousalItems={setCarousalItems}
        />
      </>
    );
  }

  if (isStacked) {
    return <CollapsedCommentPreview />;
  }

  return (
    <>
      <InnerHTMLComment
        commentCreator={comment.creator}
        stackedStyle={
          isStacked
            ? `${styles.stackedComment}`
            : `${styles.unstacked_grid_row2}`
        }
        commentText={comment.text}
        summary={comment.summary}
        id={`comment-${comment.id}-input`}
        attachmentsFromParent={comment.attachments}
        setCarousalItems={setCarousalItems}
      />
    </>
  );
};

export default SharedCommentText;
