import { useState } from "react";
import styles from "@/styles/tiptap.module.scss";
import InnerHTMLComment from "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/InnerHTMLComment";
import TutorialCreatedBy from "../Task/CreatedBy";

interface IComment {
  createdBy: string;
  imgSrc: string;
  text: string;
  createdAt: string;
}

interface IProps {
  index: number;
  comment: IComment;
}

//CommentReactions and CommentOptions removed
const CommentContainer = ({ index, comment }: IProps) => {
  const [stack, _] = useState<boolean>(false);
  return (
    <div
      className={`border-l-4 rounded outline-none comment-container
        ${stack ? "" : " shadow-md "}
        ${
          !stack
            ? "border-comment-description-border  text-white-black bg-comment-description"
            : "border-transparent hover:bg-active-elementBg "
        }
         ${stack ? "my-[4px] cursor-pointer" : "my-[8px]"}`}
      key={`interactive-comment-${index}`}
      tabIndex={0}
      id={`comment-interactive-${index}`}
    >
      <div
        className={`group rounded-tl-none rounded-bl-none w-full grid items-center
            ${
              stack
                ? ` ${styles.stackedContainer}`
                : `comment-body bg-comment-description rounded-br rounded-tr ${styles.unstackedContainer}`
            } 
            ${styles.hellow}
            `}
      >
        <CommentCreatedBy
          userImg={comment.imgSrc}
          userName={comment.createdBy}
          stack={stack}
        />
        <CommentText index={index} commentText={comment.text} stack={stack} />
      </div>
    </div>
  );
};

const CommentCreatedBy = ({
  userImg,
  userName,
  stack,
}: {
  userImg: string;
  userName: string;
  stack: boolean;
}) => {
  return <TutorialCreatedBy pfp={userImg} name={userName} size={18}/>;
};

const CommentText = ({
  index,
  commentText,
  stack,
}: {
  index: number;
  commentText: string;
  stack: boolean;
}) => {
  return (
    <InnerHTMLComment
      commentCreator={""}
      stackedStyle={
        stack ? `${styles.stackedComment}` : `${styles.unstacked_grid_row2}`
      }
      commentText={commentText}
      id={`comment-interactive-${index}-input`}
      attachmentsFromParent={[]}
    />
  );
};

export default CommentContainer;
