import useSaveContent from "@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent";
import { useGifPlayback } from "@/hooks/General/useGifPlayback";
import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom } from "@/store";
import styles from "@/styles/tiptap.module.scss";
import { hasFigmaEmbed } from "@/utils/helperFunctions/hasFigmaEmbed";
import dynamic from "next/dynamic";
import { Fragment, useContext, useRef } from "react";
import { HighlightMenu } from "../ContextMenu";
import QuoteButton from "../ContextMenu/QuoteButton";
import CollapsedCommentPreview from "./CollapsedCommentPreview";
import CommentTldr from "./CommentTldr";
import InnerHTMLComment from "./InnerHTMLComment";

const Tiptap = dynamic(() => import("@/components/RTE/TipTapTaskDetail"));

type PersistentFigmaCommentProps = {
  redirectAPI: ReturnType<typeof useSaveContent>["redirectAPI"];
  comment: ReturnType<typeof useCommentsContext>["comment"];
  index: number;
  currentUserDisplayName?: string;
  isMobile: boolean;
  isEditing: boolean;
  isCollapsed: boolean;
  currentId: ReturnType<typeof useTaskContext>["currentId"];
  allowPerks: ReturnType<typeof useTaskContext>["allowPerks"];
  editMode: ReturnType<typeof useTaskContext>["editMode"];
};

const PersistentFigmaComment = ({
  redirectAPI,
  comment,
  index,
  currentUserDisplayName,
  isMobile,
  isEditing,
  isCollapsed,
  currentId,
  allowPerks,
  editMode,
}: PersistentFigmaCommentProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const commentCreator = comment.creator;
  const { control: gifPlaybackControl } = useGifPlayback(
    containerRef,
    isEditing || isCollapsed ? undefined : comment.text,
  );

  return (
    <div
      ref={containerRef}
      className={
        isCollapsed
          ? "hidden"
          : isMobile
            ? "relative"
            : "relative [grid-column:1/3] [grid-row:2]"
      }
      aria-hidden={isCollapsed}
      data-persistent-figma-comment="true"
    >
      {!isEditing && !isCollapsed && comment.summary && (
        <CommentTldr summary={comment.summary} />
      )}

      <Tiptap
        key={comment.id}
        allowPerks={allowPerks}
        // CommentsContainer continues to render the standalone AttachmentView.
        // This prop only keeps those files in inline-image carousel navigation.
        carouselAttachments={comment.attachments}
        attachments={isMobile && isEditing ? comment.attachments : undefined}
        handleSave={redirectAPI}
        mode="read-edit-comments"
        allowEdit={isEditing}
        shouldTriggerAiTaskWriter={editMode === "edit-comment-ai"}
        isMbl={isMobile}
        commentId={comment.id}
        creatorname={currentUserDisplayName}
        isSelected={!isCollapsed && currentId === `comment-${index}-input`}
        id={`comment-${index}`}
        customPlaceholder="Comment"
        defaultContent={comment.text ?? ""}
        className1="mobile_comment_editor"
      />

      {!isEditing && !isCollapsed && commentCreator && (
        <HighlightMenu
          target={`#comment-${index}-input`}
          allowedPlacements={["top", "bottom"]}
          menu={({ selectedHtml }) => (
            <QuoteButton
              selection={selectedHtml ?? ""}
              creator={commentCreator}
            />
          )}
        />
      )}

      {!isEditing && !isCollapsed && gifPlaybackControl}
    </div>
  );
};

const CommentText = () => {
  const { redirectAPI } = useSaveContent();
  const { comment, isStacked, i } = useCommentsContext();
  const [currentUser] = useRecoilState(currentUserAtom);
  const isMobile = useContext(MobileViewContext);
  const {
    editState,
    currentId,
    allowPerks,
    editMode,
    setCarousalItems,
  } = useTaskContext();
  const isEditing = editState === i;
  const isCollapsed = isStacked && !isEditing;

  if (hasFigmaEmbed(comment.text)) {
    return (
      <Fragment>
        {isCollapsed &&
          (isMobile ? (
            <InnerHTMLComment
              key={`figma-preview-${comment.id}`}
              isStacked
              stackedStyle={styles.stackedComment}
              commentText={comment.text}
              summary={comment.summary}
              id={`comment-${comment.id}-input`}
              commentCreator={comment.creator}
              attachmentsFromParent={comment.attachments}
              setCarousalItems={setCarousalItems}
            />
          ) : (
            <CollapsedCommentPreview key={`figma-preview-${comment.id}`} />
          ))}
        <PersistentFigmaComment
          key={`figma-editor-${comment.id}`}
          redirectAPI={redirectAPI}
          comment={comment}
          index={i}
          currentUserDisplayName={currentUser?.displayName}
          isMobile={isMobile}
          isEditing={isEditing}
          isCollapsed={isCollapsed}
          currentId={currentId}
          allowPerks={allowPerks}
          editMode={editMode}
        />
      </Fragment>
    );
  }

  if (isCollapsed) {
    if (!isMobile) return <CollapsedCommentPreview />;

    return (
      <InnerHTMLComment
        isStacked
        stackedStyle={styles.stackedComment}
        commentText={comment.text}
        summary={comment.summary}
        id={`comment-${comment.id}-input`}
        commentCreator={comment.creator}
        attachmentsFromParent={comment.attachments}
        setCarousalItems={setCarousalItems}
      />
    );
  }

  if (isEditing) {
    return (
      <Tiptap
        allowPerks={allowPerks}
        carouselAttachments={comment.attachments}
        attachments={isMobile && isEditing ? comment.attachments : undefined}
        handleSave={redirectAPI}
        mode="read-edit-comments"
        allowEdit
        shouldTriggerAiTaskWriter={editMode === "edit-comment-ai"}
        isMbl={isMobile}
        commentId={comment.id}
        creatorname={currentUser?.displayName}
        isSelected={currentId === `comment-${i}-input`}
        id={`comment-${i}`}
        customPlaceholder="Comment"
        defaultContent={comment.text}
        className1="mobile_comment_editor"
      />
    );
  }

  return (
    <InnerHTMLComment
      commentCreator={comment.creator}
      stackedStyle={styles.unstacked_grid_row2}
      commentText={comment.text}
      summary={comment.summary}
      id={`comment-${comment.id}-input`}
      attachmentsFromParent={comment.attachments}
      setCarousalItems={setCarousalItems}
    />
  );
};

export default CommentText;
