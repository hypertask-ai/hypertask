import DueDateLabel from "@/components/Labels/DueDateLabel";
import TaskLabelComponent from "@/components/Modals/CreateLabel/TaskLabelComponent";
import EstimateLabelComponent from "@/components/Modals/TaskEstimate/EstimateLabelComponent";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import { IBoardTask } from "@/models/InteractiveOnboarding/model";
import Image from "next/image";
import React from "react";

type Props = {
  tIndex: number;
  cIndex: number;
  activeTask: number;
  activeColumn: number;
  task: IBoardTask;
};

const Task = ({ tIndex, cIndex, activeTask, activeColumn, task }: Props) => {
  return (
    <div
      key={`task-${tIndex}`}
      id={`task-${1}`}
      className="outline-none rounded-[5px] xs:border-[1px] md:border-none   xs:border-light-black-border-1 "
    >
      <div
        className={`shadow-md border-l-4 ${
          activeTask === tIndex && activeColumn === cIndex
            ? "border-white-black bg-kanban-active-cardbg"
            : "border-transparent bg-cardBackground"
        } rounded-[5px] outline-none `}
      >
        <div className="flex items-center   p-2 gap-2 flex-wrap">
          <TopRow task={task} />
          <div
            className={"text-white-black"}
            style={{ flex: 1, display: "flex" }}
          >
            <p
              style={{
                fontSize: 14,
                whiteSpace: "pre-line",
                textAlign: "initial",
                wordBreak: "break-all",
              }}
            >
              {task.title}
            </p>
          </div>
          <TagsRow task={task} />
        </div>
      </div>
    </div>
  );
};

const TagsRow = ({ task }: { task: IBoardTask }) => {
  return task.priority ||
    task.size ||
    task.duedate ||
    (task.labels && task.labels?.length > 0) ? (
    <div className={`basis-full flex gap-1 flex-wrap`}>
      {/* ============ priorty and labels section  ==============*/}
      {task.duedate ? (
        <>
          <DueDateLabel
            stopPropogation={true}
            flexBasis={false}
            fontWeight={500}
            onClick={() => {}}
            dueDate={task.duedate}
          />
        </>
      ) : (
        <></>
      )}
      {task.priority ? (
        // {/* ---------- priority label */}
        <>
          <PriorityLabelComponent
            stopPropogation={true}
            flexBasis={false}
            fontWeight={500}
            onClick={() => {}}
            priority={task.priority}
          />
        </>
      ) : (
        <></>
      )}
      {task.size ? (
        // {/* ---------- Estimate label */}
        <>
          <EstimateLabelComponent
            flexBasis={false}
            fontWeight={500}
            onClick={() => {}}
            estimate={task.size}
          />
        </>
      ) : (
        <></>
      )}

      {/* ===================== task labels ================= */}
      {task.labels?.map((taskLabel, index) => (
        <>
          {taskLabel && (
            <TaskLabelComponent
              key={`Label-component-${taskLabel}-${index}`}
              stopPropogation={true}
              fontWeight={500}
              onClick={() => {}}
              flexBasis={false}
              labelValue={taskLabel}
            />
          )}
        </>
      ))}

      {/* ===================== sub task count ================= */}
    </div>
  ) : (
    <></>
  );
};

const TopRow = ({ task }: { task: IBoardTask }) => {
  return (
    <>
      <div
        className={`flex gap-1 flex-wrap basis-full items-center

      `}
      >
        <span className="flex flex-grow gap-1">
          <p className="font-medium text-content sm:text-meta text-text-light-gray  uppercase text-left">
            {task.identifier}
          </p>
        </span>
        {/* commentCount && commentCount > 0? (
                <div className='bg-inherit border-[0px]  h-labelComponent 
                  text-emphasis
                  border-border-labelComponent rounded-sm flex gap-1 items-center px-[4px] py-[1px]'>
                  <CgComment className='text-label-component'/>
                  <span className='text-label-component text-meta'>
                    {commentCount}
                  </span>
                </div>
              ) : (
                <></>
              ) */}

        {task.assignee && task.assignee.length > 0 && (
          <div className="flex items-center ">
            {task.assignee.slice(0, 5).map((pfp, index) => (
              <Image
                key={index}
                loading="lazy"
                src={pfp}
                alt=""
                width={22}
                height={22}
                className={`${
                  index === 0 ? "ml-[0px] " : "ml-[-14px]"
                } rounded-[19px]`}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default Task;
