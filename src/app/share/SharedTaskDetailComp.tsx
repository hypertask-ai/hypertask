/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/jsx-key */
/* eslint-disable react/no-danger-with-children */
// /* eslint-disable react-hooks/exhaustive-deps */
// /* eslint-disable @next/next/no-img-element */
"use client";
import "@/styles/taskDetail.scss";
import { currentProjectAtom } from "@/store";
import DescriptionAndCommentsProvider from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { Suspense, useContext, useEffect } from "react";
import { useRecoilState } from "@/lib/state";
import { useGetPriorityForTask } from "@/hooks/MultiPages/useGetPriorityForTask";
import { useGetEstimateForTask } from "@/hooks/MultiPages/useGetEstimateForTask";
import { useGetAllTaskLabels } from "@/hooks/MultiPages/useGetAllTaskLabels";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import useSetStickyHeight from "@/hooks/Task Detail/useSetStickyHeight";
import TaskDetailMainContainer from "@/components/PageComponents/TaskDetail/TaskDetailMainContainer";
import { useFollowersContext } from "@/lib/contexts/TaskDetail/FollowersProvider";
import SharedTaskTitleContainer from "@/components/PageComponents/TaskDetail/SharedTask/TopRow/TaskTitleContainer";
import SharedCommentAndDescriptionContainer from "@/components/PageComponents/TaskDetail/SharedTask/CommentsAndDescription/CommentsAndDescriptionContainer";
import SharedTaskInfo from "@/components/PageComponents/TaskDetail/SharedTask/MainPage/TaskInfoColumn";
import dynamic from "next/dynamic";
import { ITask } from "@/models/model";
const AttachmentCarousel = dynamic(
  () => import("@/components/Common/AttachmentsView/AttachmentsCarousel"),
  { ssr: false },
);

const SharedTaskDetailComp: React.FC<{ _slugs: string[] }> = ({ _slugs }) => {
  // =================== CONVERT STRINGS TO OBJECTS
  const { currentTask: ct, carousalItems, setCarousalItems } = useTaskContext();
  const parsedTask = ct as unknown as ITask;
  const { dynamicTopValue, dynamicElementRef } = useSetStickyHeight();
  const { followers } = useFollowersContext();

  const { data: priority } = useGetPriorityForTask(
    ["priority", parsedTask?.id],
    parsedTask?.id,
    parsedTask?.priority,
  );
  const { data: estimate } = useGetEstimateForTask(
    ["estimate", parsedTask?.id],
    parsedTask?.id,
    parsedTask?.estimate,
  );

  const { data: labelsFromTQ } = useGetAllTaskLabels(parsedTask?.id, []);
  const [_, setCurrentProject] = useRecoilState(currentProjectAtom);
  const _mbl = useContext(MobileViewContext);

  useEffect(() => {
    if (parsedTask && parsedTask?.project) {
      setCurrentProject(parsedTask.project);
    }
  }, [parsedTask]);

  if (!parsedTask) {
    return null;
  }

  return (
    <>
      <DescriptionAndCommentsProvider>
        <TaskDetailMainContainer bodyClassName="">
          <SharedTaskTitleContainer containerRef={dynamicElementRef} />

          {/* --------------------------- COMMENTS + DESCRIPTION CONTAINER ------------------------------ */}
          <div
            id="taskInfo_comments_description_container"
            className={`task-detail-horizontal-padding  ${
              _mbl
                ? "flex-col-reverse gap-2 xs:px-[18px] scrollbar-none  comments_description_container"
                : "mt-0 pl-1"
            } `}
            style={{
              display: "flex",
              flex: 1,
              width: "100%",
            }}
          >
            <Suspense fallback={<>Loading...</>}>
              <SharedCommentAndDescriptionContainer />
            </Suspense>

            {/* ====================================== RIGHT HALF ================================ */}

            <SharedTaskInfo
              dynamicTopValue={dynamicTopValue}
              slugs={[_slugs[0], _slugs[1]]}
              currentTask={parsedTask}
              followers={followers}
              labelsFromTQ={labelsFromTQ}
              priority_={priority}
              estimate_={estimate}
            />
          </div>
        </TaskDetailMainContainer>
        {carousalItems && (
          <AttachmentCarousel
            closeCallback={() => {
              setCarousalItems(undefined);
            }}
            attachments={carousalItems.attachments}
            currentIndex={carousalItems.currentIndex}
          />
        )}
      </DescriptionAndCommentsProvider>
    </>
  );
};

export default SharedTaskDetailComp;
