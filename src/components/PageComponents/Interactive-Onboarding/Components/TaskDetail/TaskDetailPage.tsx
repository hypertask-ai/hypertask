import React from "react";
import TaskHeadingContainer from "./Task/TaskHeading";
import TaskCommentsAndDescriptionContainer from "./Task/TaskCommentsAndDescription";
import TaskMovementContainer from "./Task/TaskMovementButtons";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";

const TaskDetailPageContainer = () => {
  const { activeTaskPage, board, title, activeScene } = useTutorialContext();

  return (
    <>
      <div
        className={
          "@container min-w-0 flex items-center justify-center flex-col w-full min-h-screen bg-taskDetailPage"
        }
      >
        <div
          id="body"
          className={
            "w-min max-w-[84cqw] @xl:max-w-[66cqw] min-h-screen px-8 @xl:px-16 flex flex-col items-start space-y-4 bg-taskDetal-container @sm:pb-6 @lg:pb-16 @xl:pb-48"
          }
        >
          <TaskHeadingContainer
            heading={
              activeScene.index > 31 && title.length > 0
                ? title
                : board.taskPages[activeTaskPage].headingTitle
            }
          />
          <TaskCommentsAndDescriptionContainer
            task={board.taskPages[activeTaskPage]}
          />
        </div>
      </div>
      <TaskMovementContainer />
    </>
  );
};

export default TaskDetailPageContainer;
