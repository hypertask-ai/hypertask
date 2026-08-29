/* eslint-disable react/jsx-key */

import { IAgent, IAssignees, ITask, IUser } from "@/models/model";
import { taskBaseUri } from "@/utils";
import { useContext, useMemo, useState } from "react";
import {
  AssigneeCard,
  ClickableSpan,
  TaskInfoLabel,
  TaskInfoRow,
  TaskInfoValue,
} from "@/components/PageComponents/TaskDetail/MainPageComponents";
import Tooltip from "@/components/Common/Tooltip";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import dynamic from "next/dynamic";
import { splitAssignees } from "@/lib/assignees";

const AssignModal = dynamic(
  () => import("@/components/Modals/AssignToUser/AssignToUser")
);
const AssigneesContainer = ({
  slugs,
  currentTask,
  showAssigneeModal,
  toggleAssigneeModal,
  showTooltip = true,
}: {
  slugs: string[];
  showAssigneeModal: boolean;
  currentTask: ITask;
  toggleAssigneeModal: (_assignees?: IAssignees[], _keepOpen?: boolean) => void;
  showTooltip?: boolean;
}) => {
  const isMbl = useContext(MobileViewContext);
  const [pickerMode, setPickerMode] = useState<"assignees" | "agents">(
    "assignees",
  );

  const { humanAssignees, agentAssignees } = useMemo(
    () => splitAssignees(currentTask.assignees),
    [currentTask.assignees],
  );
  const assignedUsers = [...humanAssignees, ...agentAssignees];
  const taskLink = `${taskBaseUri}${slugs[0]}/${slugs[1]}`;
  const openPicker = (mode: "assignees" | "agents") => {
    setPickerMode(mode);
    toggleAssigneeModal();
  };
  const closePicker = (
    nextAssignees?: IAssignees[],
    keepOpen?: boolean,
  ) => {
    toggleAssigneeModal(nextAssignees, keepOpen);
    if (!keepOpen) setPickerMode("assignees");
  };

  const renderAssigneeGroup = (
    label: "Assignees" | "Agents",
    users: (IUser | IAgent)[],
  ) => (
    <TaskInfoRow>
      <TaskInfoLabel
        onClick={() =>
          openPicker(label === "Agents" ? "agents" : "assignees")
        }
      >
        {label}
        {showTooltip && (
          <Tooltip
            portal
            left={0}
            bottom={-40}
            text={
              label === "Agents"
                ? "Assign / unassign agents"
                : "Assign / unassign people"
            }
            keyCombination={["A"]}
          />
        )}
      </TaskInfoLabel>

      <TaskInfoValue
        onClick={() =>
          openPicker(label === "Agents" ? "agents" : "assignees")
        }
      >
        {users.length < 1 &&
          (label === "Agents" ? (
            <ClickableSpan title="No agents" />
          ) : (
            <>The Assignees</>
          ))}

        {users.length > 0 && (
          <div
            className={`min-w-0 relative group overflow-hidden ${
              isMbl
                ? "flex flex-row flex-wrap gap-1 "
                : "space-y-3 cursor-pointer rounded-[4px] relative group"
            }`}
          >
            {users.map((user, i) => (
              <AssigneeCard
                user={user}
                i={i}
                _mbl={isMbl ?? false}
                projectId={currentTask.projectId}
                key={`${label.toLowerCase()}-card-${i}`}
              />
            ))}
            {showTooltip && (
              <Tooltip
                portal
                left={0}
                bottom={-40}
                text={
                  label === "Agents"
                    ? "Assign / unassign agents"
                    : "Assign / unassign people"
                }
                keyCombination={["A"]}
              />
            )}
          </div>
        )}
      </TaskInfoValue>
    </TaskInfoRow>
  );

  return (
    <>
      {renderAssigneeGroup("Assignees", humanAssignees)}
      {renderAssigneeGroup("Agents", agentAssignees)}

      {showAssigneeModal && (
        <AssignModal
          onClose={closePicker}
          project={currentTask.project}
          task={{
            id: currentTask.id,
            title: currentTask.title,
            link: taskLink,
          }}
          assignees={assignedUsers}
          title={pickerMode === "agents" ? "Assign agents" : "Assign"}
          includePeople={pickerMode !== "agents"}
        />
      )}
    </>
  );
};

export default AssigneesContainer;
