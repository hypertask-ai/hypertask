import React from "react";
import TaskCommentsContainer from "../Comment/TaskComments";
import { IBoardTaskPage } from "@/models/InteractiveOnboarding/model";
import DescriptionContainer from "../Description/DescriptionContainer";
import TaskInfoContainer from "./TaskInfo";
import DescriptionBody from "../Description/DescriptionBody";
import BaseCommentAndDescriptionContainer from "@/components/PageComponents/TaskDetail/CommentAndDescription/BaseCommentAndDescriptionContainer";

interface IProp {
  task: IBoardTaskPage;
}

const TaskCommentsAndDescriptionContainer = ({ task }: IProp) => {
  return (
    <div
      id="taskInfo_comments_description_container"
      className={`mt-0 pl-1`}
      style={{
        display: "flex",
        flex: 1,
        width: "100%" }}
    >
      <BaseCommentAndDescriptionContainer>
        {/**----------------------------------DESCRIPTION EDITOR */}
        <DescriptionContainer>
          <DescriptionBody
            creatorImg={task.creatorImg}
            creatorName={task.creatorName}
            content={task.descriptionContainer}
          />
        </DescriptionContainer>

        {/**----------------------------------COMMENTS */}
        <TaskCommentsContainer comments={task.comments} />
      </BaseCommentAndDescriptionContainer>

      {/* ====================================== RIGHT HALF ================================ */}
      <TaskInfoContainer task={task.taskInfo} />
    </div>
  );
};

export default TaskCommentsAndDescriptionContainer;
