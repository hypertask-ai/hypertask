import React from "react";
import CommentContainer from "./CommentContainer";
import NewComment from "./NewComment";
import TutorialTaskActivity from "./CommentActivity";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";

interface IComment {
  createdBy: string;
  imgSrc: string;
  text: string;
  createdAt: string;
}

interface IProp {
  comments: IComment[];
}

const TaskCommentsContainer = ({ comments }: IProp) => {
  const { activeScene, activeBoard, activeTaskPage } = useTutorialContext();

  return (
    <>
      {comments.map((comment, index) => (
        <CommentContainer
          comment={comment}
          index={index}
          key={`comment-container-interactive-${index}`}
        />
      ))}

      {activeBoard === 0 && activeTaskPage === 0 && activeScene.index > 8 && (
        <TutorialTaskActivity type="assign" />
      )}
      {activeBoard === 0 && activeTaskPage === 0 && activeScene.index > 10 && (
        <TutorialTaskActivity type="priority" />
      )}
       {activeBoard === 1 && activeTaskPage === 0 && activeScene.index > 27 && (
        <TutorialTaskActivity type="move" />
      )}
      <NewComment />
    </>
  );
};

export default TaskCommentsContainer;
