import styles from "@/styles/tiptap.module.scss";
import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import { ReactNode, useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { CreatedAtCard } from "./CommentOptions";
import {
  ITaskArchiveActivity,
  ITaskAssignedActivity,
  ITaskDueDateActivity,
  ITaskEstimateActivity,
  ITaskLabelActivity,
  ITaskMoveActivity,
  ITaskPriorityActivity,
  ITaskPullRequestActivity,
  ITaskUpdateDescriptionActivity,
  ITaskWaitingOnActivity,
} from "@/models/ActivityModels.ts";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import EstimateLabelComponent from "@/components/Modals/TaskEstimate/EstimateLabelComponent";
import TaskLabelComponent from "@/components/Modals/CreateLabel/TaskLabelComponent";
import CreatedBy from "../Common/CreatedBy";
import DueDateLabel from "@/components/Labels/DueDateLabel";
import { activityAgentId } from "@/lib/agents/activityAttribution";
import { pullRequestBadgeByState } from "@/components/PageComponents/TaskDetail/pullRequestBadge";

const CommentTaskActivity = () => {
  const { comment } = useCommentsContext();
  const _mbl = useContext(MobileViewContext);

  // Provenance (HTPR-4620): who actually made this change. Empty for a person,
  // the agent id when a managed agent did it. The same reader the writer uses,
  // so the row and the stored column can never disagree.
  const actingAgentId = activityAgentId(comment.activity) ?? "";

  return (
    <div
      data-activity-agent={actingAgentId}
      className={`
            px-[16px] ${styles.stackedContainer} font-normal
              
            ${_mbl ? "block" : "flex justify-between "}
             
            text-white-black-black`}
    >
      <span className="text-content mr-2 sm:mr-0 sm:text-content text-text-light-gray flex items-center gap-1 flex-wrap">
        {comment.activity?.type === "TaskMove" ? (
          <>
            <TaskMovedActivity activity={comment.activity} />
          </>
        ) : comment.activity?.type === "TaskAssigned" ? (
          <>
            <TaskAssignedActivity activity={comment.activity} />
          </>
        ) : comment.activity?.type === "TaskPriority" ? (
          <>
            <TaskPriorityActivity activity={comment.activity} />
          </>
        ) : comment.activity?.type === "TaskEstimate" ? (
          <>
            <TaskEstimateActivity activity={comment.activity} />
          </>
        ) : comment.activity?.type === "TaskLabel" ? (
          <>
            <TaskLabelActivity activity={comment.activity} />
          </>
        ) : comment.activity?.type === "TaskArchive" ? (
          <>
            <TaskArchivedActivity activity={comment.activity} />
          </>
        ) : comment.activity?.type === "TaskDueDate" ? (
          <>
            <TaskDueDateActivity activity={comment.activity} />
          </>
        ) : comment.activity?.type === "TaskDescriptionUpdate" ? (
          <>
            <TaskDescriptionUpdateActivity activity={comment.activity} />
          </>
        ) : comment.activity?.type === "TaskWaitingOn" ? (
          <TaskWaitingOnActivity activity={comment.activity} />
        ) : comment.activity?.type === "TaskPullRequest" ? (
          <TaskPullRequestActivity activity={comment.activity} />
        ) : null}
      </span>
      {!_mbl && <CreatedAtCard stacked={true} createdAt={comment.createdAt} />}
    </div>
  );
};

const BoldElement = ({ children }: { children: ReactNode }) => {
  return <b className="text-white-black  font-normal">{children}</b>;
};

const CreatedByLocal = ({ name, pfp }: { name: string; pfp: string }) => {
  return <CreatedBy pfp={pfp ?? ""} name={name ?? ""} isStacked={false} />;
};

const TaskDueDateActivity = ({
  activity,
}: {
  activity: ITaskDueDateActivity;
}) => {
  const fromObj = {
    displayName: activity.data.fromAgent?.displayName ?? activity.data.fromUser?.displayName ?? "",
    photoURL: activity.data.fromAgent?.photoURL ?? activity.data.fromUser?.photoURL ?? "",
  };

  if (!activity.data.fromDueDate && activity.data.toDueDate) {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        set a new due date:{" "}
        <DueDateLabel
          flexBasis={false}
          fontWeight={500}
          dueDate={activity.data.toDueDate}
        />
      </>
    );
  } else if (!activity.data.toDueDate) {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        removed the due date
      </>
    );
  } else if (activity.data.toDueDate && activity.data.fromDueDate) {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        set the due date from{" "}
        <DueDateLabel
          flexBasis={false}
          fontWeight={500}
          dueDate={activity.data.fromDueDate}
        />{" "}
        to{" "}
        <DueDateLabel
          flexBasis={false}
          fontWeight={500}
          dueDate={activity.data.toDueDate}
        />
      </>
    );
  }
  return <></>;
};

const TaskMovedActivity = ({ activity }: { activity: ITaskMoveActivity }) => {
  const fromObj = {
    displayName: activity.data.fromAgent?.displayName ?? activity.data.fromUser?.displayName ?? "",
    photoURL: activity.data.fromAgent?.photoURL ?? activity.data.fromUser?.photoURL ?? "",
  };

  if (activity.data.statusFlipCount) {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        changed the status between{" "}
        <BoldElement>{activity.data.fromSection?.sectionTitle}</BoldElement> and{" "}
        <BoldElement>{activity.data.toSection?.sectionTitle}</BoldElement>{" "}
        {activity.data.statusFlipCount + 1} times, ending in{" "}
        <BoldElement>{activity.data.currentSection?.sectionTitle}</BoldElement>
      </>
    );
  }

  return (
    <>
      <BoldElement>
        <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
      </BoldElement>{" "}
      changed the status from{" "}
      <BoldElement>{activity.data.fromSection?.sectionTitle}</BoldElement> to{" "}
      <BoldElement>{activity.data.toSection?.sectionTitle}</BoldElement>
    </>
  );
};

const TaskDescriptionUpdateActivity = ({
  activity,
}: {
  activity: ITaskUpdateDescriptionActivity;
}) => {
  const fromObj = {
    displayName: activity.data.fromAgent?.displayName ?? activity.data.fromUser?.displayName ?? "",
    photoURL: activity.data.fromAgent?.photoURL ?? activity.data.fromUser?.photoURL ?? "",
  };

  return (
    <>
      <BoldElement>
        <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
      </BoldElement>{" "}
      updated description.
    </>
  );
};

const TaskWaitingOnActivity = ({
  activity,
}: {
  activity: ITaskWaitingOnActivity;
}) => (
  <>
    <BoldElement>
      <CreatedByLocal
        name={activity.data.fromUser.displayName ?? ""}
        pfp={activity.data.fromUser.photoURL ?? ""}
      />
    </BoldElement>{" "}
    {activity.data.waitingOnDisplayName
      ? `marked this blocked by ${activity.data.waitingOnDisplayName}`
      : "cleared blocked by"}
  </>
);

const TaskPullRequestActivity = ({
  activity,
}: {
  activity: ITaskPullRequestActivity;
}) => {
  const { action, pullRequest, fromAgent, fromUser } = activity.data;
  const badge = pullRequestBadgeByState[pullRequest.displayState];
  const statusBadge = (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold leading-none"
      style={{ color: badge.color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: badge.color }}
      />
      {badge.label}
    </span>
  );
  const actor = fromAgent ?? fromUser;

  if (action === "linked") {
    return (
      <>
        {actor && (
          <BoldElement>
            <CreatedByLocal
              name={actor.displayName ?? ""}
              pfp={actor.photoURL ?? ""}
            />
          </BoldElement>
        )}{" "}
        linked pull request{" "}
        <a href={pullRequest.url} target="_blank" rel="noopener noreferrer">
          <BoldElement>#{pullRequest.number}</BoldElement>
        </a>{" "}
        {statusBadge}
      </>
    );
  }

  return (
    <>
      Pull request{" "}
      <a href={pullRequest.url} target="_blank" rel="noopener noreferrer">
        <BoldElement>#{pullRequest.number}</BoldElement>
      </a>{" "}
      {action === "closed" ? "was" : "checks turned"} {statusBadge}
    </>
  );
};

const TaskAssignedActivity = ({
  activity,
}: {
  activity: ITaskAssignedActivity;
}) => {
  const fromObj = {
    displayName: activity.data.fromAgent?.displayName ?? activity.data.fromUser?.displayName,
    photoURL: activity.data.fromAgent?.photoURL ?? activity.data.fromUser?.user.photoURL,
  };
  const toObj = {
    displayName: activity.data.toAgent?.displayName ?? activity.data.toUser?.displayName,
    photoURL: activity.data.toAgent?.photoURL ?? activity.data.toUser?.user.photoURL,
  };

  const fromAgentId = activity.data.fromAgent?.id;
  const toAgentId = activity.data.toAgent?.id;
  let inferredSelfAssignment = false;
  if (
    fromAgentId !== null &&
    fromAgentId !== undefined &&
    toAgentId !== null &&
    toAgentId !== undefined
  ) {
    inferredSelfAssignment = fromAgentId === toAgentId;
  } else if (!activity.data.fromAgent && !activity.data.toAgent) {
    inferredSelfAssignment =
      activity.data.fromUser.userId === activity.data.toUser.userId;
  }
  const isSelf = activity.data.isSelfAssignment ?? inferredSelfAssignment;

  if (isSelf) {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName ?? ""} pfp={fromObj.photoURL ?? ""} />
        </BoldElement>{" "}
        {activity.data.updatedStatus === "Unassigned"
          ? "unassigned themself from this task."
          : "assigned themself to this task."}
      </>
    );
  }

  return (
    <>
      <BoldElement>
        <CreatedByLocal name={fromObj.displayName ?? ""} pfp={fromObj.photoURL ?? ""} />
      </BoldElement>{" "}
      {activity.data.updatedStatus === "Unassigned" ? "unassigned" : "assigned"}{" "}
      <BoldElement>
        <CreatedByLocal name={toObj.displayName ?? ""} pfp={toObj.photoURL ?? ""} />
      </BoldElement>
      .
    </>
  );
};

// ======================= Priority Element
const TaskPriorityActivity = ({
  activity,
}: {
  activity: ITaskPriorityActivity;
}) => {
  const fromObj = {
    displayName: activity.data.fromAgent?.displayName ?? activity.data.fromUser?.displayName ?? "",
    photoURL: activity.data.fromAgent?.photoURL ?? activity.data.fromUser?.photoURL ?? "",
  };

  // if priority was created, from would be missing
  if (activity.data.toPriority?.priority_index === 0) {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        set the priority as none.
      </>
    );
  }

  // if priority was created, from would be missing
  if (activity.data.fromPriority?.priority === undefined) {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        prioritized this task to{" "}
        <>
          <PriorityLabelComponent fontSize={10} priority={activity?.data.toPriority} />
        </>
        .
      </>
    );
  } else {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        updated the priority from
        <>
          <PriorityLabelComponent fontSize={10} priority={activity?.data.fromPriority} />{" "}
          to{" "}
          <PriorityLabelComponent fontSize={10} priority={activity?.data.toPriority} />
        </>
        .
      </>
    );
  }
};

// ======================= Estimate Activity Element
const TaskEstimateActivity = ({
  activity,
}: {
  activity: ITaskEstimateActivity;
}) => {
  const fromObj = {
    displayName: activity.data.fromAgent?.displayName ?? activity.data.fromUser?.displayName ?? "",
    photoURL: activity.data.fromAgent?.photoURL ?? activity.data.fromUser?.photoURL ?? "",
  };

  if (!activity.data.fromEstimate?.estimate) {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        set task size as{" "}
        <>
          <EstimateLabelComponent fontSize={10} estimate={activity?.data.toEstimate} />
        </>
        .
      </>
    );
  } else
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        updated the task size from
        <>
          <EstimateLabelComponent fontSize={10} estimate={activity?.data.fromEstimate} />{" "}
          to{" "}
          <EstimateLabelComponent fontSize={10} estimate={activity?.data.toEstimate} />
          .
        </>
      </>
    );
};

// ======================= Label Activity Element
const TaskLabelActivity = ({ activity }: { activity: ITaskLabelActivity }) => {
  const fromObj = {
    displayName: activity.data.fromAgent?.displayName ?? activity.data.fromUser?.displayName ?? "",
    photoURL: activity.data.fromAgent?.photoURL ?? activity.data.fromUser?.photoURL ?? "",
  };

  if (!activity?.data.toLabel.label?.value) return <></>;
  if (activity.status === "Created") {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        created label{" "}
        <>
          <TaskLabelComponent fontSize={10} labelValue={activity?.data.toLabel.label?.value} />{" "}
          and added it to this task.
        </>
      </>
    );
  } else if (activity.status === "Assigned") {
    return (
      <>
        <BoldElement>
          <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
        </BoldElement>{" "}
        assigned label{" "}
        <>
          <TaskLabelComponent fontSize={10} labelValue={activity?.data.toLabel.label?.value} />{" "}
          to this task.
        </>
      </>
    );
  }

  // label removed
  return (
    <>
      <BoldElement>
        <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
      </BoldElement>{" "}
      removed label{" "}
      <>
        <TaskLabelComponent fontSize={10} labelValue={activity?.data.toLabel.label?.value} />{" "}
        from this task.
      </>
    </>
  );
};

// ======================= TASK ARCHIVED ELEMENT
const TaskArchivedActivity = ({
  activity,
}: {
  activity: ITaskArchiveActivity;
}) => {
  const fromObj = {
    displayName: activity.data.fromAgent?.displayName ?? activity.data.fromUser?.displayName ?? "",
    photoURL: activity.data.fromAgent?.photoURL ?? activity.data.fromUser?.photoURL ?? "",
  };

  const archivebody =
    activity?.data.newStatus === "Archive" ? "archived" : "unarchived";

  return (
    <>
      <BoldElement>
        <CreatedByLocal name={fromObj.displayName} pfp={fromObj.photoURL} />
      </BoldElement>{" "}
      {archivebody} the task.
    </>
  );
};

export default CommentTaskActivity;
