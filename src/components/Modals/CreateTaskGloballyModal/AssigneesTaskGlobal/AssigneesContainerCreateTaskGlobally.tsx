import Tooltip from "@/components/Common/Tooltip";
import {
  AssigneeCard,
  TaskInfoLabel,
  TaskInfoValue,
} from "@/components/PageComponents/TaskDetail/MainPageComponents";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContextCreateTaskModal } from "@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal";
import React, { useContext, useState } from "react";
import AssignModal from "../../AssignToUser/AssignToUser";
import { IUser } from "@/models/model";

interface IProps {
  toggleModal: () => void;
  showModal: boolean;
}
const AssigneesContainerCreateTaskGlobally: React.FC<IProps> = ({
  toggleModal,
  showModal,
}) => {
  const isMbl = useContext(MobileViewContext);
  const { formValues, handleChange } = useContextCreateTaskModal();

  const callbackHandler = (user?: IUser) => {
    toggleModal();
    if (!user) return;
    console.log("🚀 ~ callbackHandler ~ user:", user);
    const olderAssignees = formValues.assignees;

    // Check if the user already exists in the list
    const userExists = olderAssignees.some(
      (assignee) => assignee.id === user.id
    );
    let newerAssignees;
    if (userExists) {
      // If the user exists, remove them from the list
      newerAssignees = olderAssignees.filter(
        (assignee) => assignee.id !== user.id
      );
    } else {
      // If the user doesn't exist, add them to the list
      newerAssignees = [...olderAssignees, user];
    }

    console.log("🚀 ~ callbackHandler ~ newerAssignees:", newerAssignees);
    handleChange("assignees", newerAssignees);
  };

  if (!formValues.currentProject) return <></>;
  return (
    <>
      <TaskInfoLabel
        onClick={() => toggleModal()}
        className="relative group cursor-pointer"
      >
        Assignees
        <Tooltip
          left={-20}
          bottom={-40}
          text="Assign / unassign people"
          keyCombination={["A"]}
        />
      </TaskInfoLabel>

      <TaskInfoValue
        onClick={() => toggleModal()}
        className="group cursor-pointer overflow-hidden"
      >
        {formValues.assignees.length < 1 && (
          <span
            className="relative whitespace-nowrap text-meta xl:text-content"
            style={{ color: "#8E9093" }}
          >
            The Assignees
            <Tooltip
              left={-20}
              bottom={-40}
              text="Assign / unassign people"
              keyCombination={["A"]}
            />
          </span>
        )}
        {formValues.assignees.length > 0 && (
          <div
            className={`min-w-0 overflow-hidden ${
              isMbl
                ? "flex flex-row flex-wrap gap-1"
                : "space-y-3 rounded-[4px] relative"
            }`}
          >
            {formValues.assignees.map(
              (user, i) =>
                user && (
                  <AssigneeCard
                    key={`assigned-user-card-${i}`}
                    user={user}
                    i={i}
                    _mbl={isMbl ?? false}
                  />
                )
            )}
            <Tooltip
              left={-20}
              bottom={-40}
              text="Assign / unassign people"
              keyCombination={["A"]}
            />
          </div>
        )}
      </TaskInfoValue>

      {showModal && (
        <AssignModal
          mode="Create"
          onClose={callbackHandler}
          project={formValues.currentProject!}
          assignees={formValues.assignees}
        />
      )}
    </>
  );
};

export default AssigneesContainerCreateTaskGlobally;
