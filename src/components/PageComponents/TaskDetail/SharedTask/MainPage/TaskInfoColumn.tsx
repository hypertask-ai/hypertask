import React, { Suspense, useContext } from "react";
import {
  AssigneeCard,
  ClickableSpan,
  LocalRightSideInfo,
  TaskInfoColumnContainer,
  TaskInfoLabel,
  TaskInfoRow,
  TaskInfoValue,
} from "../../MainPageComponents";
import AssigneesContainer from "../../AssigneesContainer";
import dynamic from "next/dynamic";
const Tooltip = dynamic(() => import("@/components/Common/Tooltip"), {
  ssr: false,
});
import { ITask, ITaskLabel } from "@/models/model";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import { EstimateConstants } from "@/lib/constants/constants";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import DueDateLabel from "@/components/Labels/DueDateLabel";
import TaskLabelComponent from "@/components/Modals/CreateLabel/TaskLabelComponent";

interface IProps {
  dynamicTopValue: number;
  slugs: string[];
  currentTask: ITask | null;
  followers: any[];
  labelsFromTQ: any;
  estimate_: any;
  priority_: any;
}

const SharedTaskInfo = ({
  dynamicTopValue,
  slugs,
  currentTask,
  followers,
  labelsFromTQ,
  estimate_,
  priority_,
}: IProps) => {
  const _mbl = useContext(MobileViewContext);
  return (
    <TaskInfoColumnContainer
      heightVariant="fit"
      style={
        _mbl
          ? { top: dynamicTopValue }
          : {
              top: dynamicTopValue,
              maxHeight: `calc(100dvh - ${dynamicTopValue}px - 16px)`,
              overflowY: "auto",
              overscrollBehavior: "contain",
            }
      }
    >
      {/* ====================================== ASSIGNEES ================================ */}

      <TaskInfoRow>
        <AssigneesContainer
          showAssigneeModal={false}
          toggleAssigneeModal={() => {}}
          slugs={slugs}
          currentTask={currentTask!}
          showTooltip={false}
        />
      </TaskInfoRow>

      {/* ===================================== TASK ID ====================================== */}
      {currentTask?.ticketNumber && (
        <TaskInfoRow>
          <TaskInfoLabel>ID</TaskInfoLabel>
          <TaskInfoValue className="task-ticket-id uppercase">
            {`${currentTask?.ticketNumber ?? ""}`}
          </TaskInfoValue>
        </TaskInfoRow>
      )}

      {/* ====================================== TASK STATUS ================================ */}
      {currentTask?.id != -1 && (
        <TaskInfoRow>
          <>
            <LocalRightSideInfo
              onClick={() => {}}
              title="Status"
              left={-44}
              bottom={-40}
              tooltipText="Change Status"
              key={"Status"}
              KeyCombination={["M"]}
              showTooltip={false}
            />

            <TaskInfoValue
              className={`${_mbl ? "text-white-black" : "w-full cursor-pointer"} group w-full`}
            >
              <ClickableSpan title={currentTask?.section!} />
            </TaskInfoValue>
          </>
        </TaskInfoRow>
      )}

      {/* ====================================== TASK DUE DATE ================================ */}
      <TaskInfoRow>
        <LocalRightSideInfo
          onClick={() => {}}
          title="Due date"
          left={-44}
          bottom={-40}
          tooltipText="Set due date"
          key={"due date"}
          KeyCombination={["D"]}
          showTooltip={false}
        />

        <TaskInfoValue className="cursor-pointer group">
          <Suspense fallback={<></>}>
            {currentTask?.dueDate ? (
              <DueDateLabel
                stopPropogation={true}
                flexBasis={false}
                fontWeight={500}
                onClick={() => {}}
                dueDate={currentTask?.dueDate}
              />
            ) : (
              "-"
            )}
          </Suspense>
        </TaskInfoValue>
      </TaskInfoRow>

      {/* ====================================== TASK PROJECT ================================ */}
      <TaskInfoRow>
        <LocalRightSideInfo
          onClick={() => {}}
          title={"Project"}
          left={-44}
          bottom={-40}
          tooltipText="Change Project"
          key={"Change Project"}
          KeyCombination={["SHIFT", "M"]}
          showTooltip={false}
        />

        <TaskInfoValue className="cursor-pointer group">
          {currentTask?.project?.title}
        </TaskInfoValue>
      </TaskInfoRow>

      {/* ====================================== TASK Priority ================================ */}
      <TaskInfoRow>
        <LocalRightSideInfo
          onClick={() => {}}
          title="Priority"
          left={-44}
          bottom={-40}
          tooltipText="Set priority"
          key={"priority"}
          KeyCombination={["P"]}
          showTooltip={false}
        />

        <TaskInfoValue className="cursor-pointer group">
          <Suspense fallback={<></>}>
            {priority_ ? (
              <PriorityLabelComponent
                stopPropogation={false}
                priority={priority_}
              />
            ) : (
              <ClickableSpan title="No Priority" />
            )}
          </Suspense>
        </TaskInfoValue>
      </TaskInfoRow>

      {/* ====================================== TASK Estimate ================================ */}
      <TaskInfoRow>
        <LocalRightSideInfo
          onClick={() => {}}
          title="Task size"
          left={-44}
          bottom={-40}
          tooltipText="Set task size"
          key={"task size"}
          KeyCombination={["S"]}
          showTooltip={false}
        />

        <TaskInfoValue className="cursor-pointer group">
          <Suspense fallback={<></>}>
            <ClickableSpan
              title={
                (estimate_
                  ? EstimateConstants.find(
                      (x) => x.estimate_index === estimate_?.estimate_index
                    )?.estimate_full_value
                  : "-") ?? "-"
              }
            />
          </Suspense>
        </TaskInfoValue>
      </TaskInfoRow>

      {/* ====================================== TASK Labels ================================ */}
      <TaskInfoRow>
        <LocalRightSideInfo
          onClick={() => {}}
          title="Tags"
          left={-44}
          bottom={-40}
          tooltipText="Set tags"
          key={"tags"}
          KeyCombination={["T"]}
          showTooltip={false}
        />

        {labelsFromTQ?.length > 0 ? (
          <TaskInfoValue className="flex flex-wrap gap-2 cursor-pointer group">
            {labelsFromTQ?.map(
              (taskLabel: ITaskLabel, index: any) =>
                taskLabel.label?.value && (
                  <TaskLabelComponent
                    flexBasis={false}
                    stopPropogation={false}
                    labelValue={taskLabel.label?.value}
                    key={`task-label-${index}`}
                    taskDetail={true}
                  />
                )
            )}
          </TaskInfoValue>
        ) : (
          <TaskInfoValue className="text-start cursor-pointer group">
            <ClickableSpan title="No tags" />
          </TaskInfoValue>
        )}
      </TaskInfoRow>
      {/* ====================================== Followers ================================ */}
      {followers.length > 0 && (
        <TaskInfoRow>
          <TaskInfoLabel>Followers</TaskInfoLabel>
          <TaskInfoValue
            className={_mbl ? "flex flex-row" : "flex flex-col"}
          >
            {followers.length < 1 && (
              <span style={{ color: "#8E9093" }}>The Assignees</span>
            )}
            {followers.length > 0 && (
              <div
                className={`text-white-black ${
                  _mbl
                    ? "py-1 flex flex-row flex-wrap gap-1"
                    : "space-y-3 rounded-[4px]"
                }`}
              >
                {followers?.map((item, i) => (
                  <AssigneeCard user={item.user} _mbl={_mbl} key={i} i={i} />
                ))}
              </div>
            )}
          </TaskInfoValue>
        </TaskInfoRow>
      )}
    </TaskInfoColumnContainer>
  );
};

export default SharedTaskInfo;
