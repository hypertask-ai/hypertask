import { FC } from "react";
import UserSelectionModal from "../UserSelectionModal";
import { IAgent, IUser } from "@/models/model";
import { useUpdatedByFilter } from "@/hooks/MultiPages/Filters/useUpdatedByFilter";
import type { CalendarUserSummary } from "@/lib/calendarSync/contract";

interface IProps {
  updatedByHandler: (
    param?: IUser | CalendarUserSummary | IAgent,
  ) => Promise<void>;
  calendarMembers?: CalendarUserSummary[];
  view: "Kanban" | "Calendar";
}
const UpdatedByFilterModal: FC<IProps> = ({
  updatedByHandler,
  calendarMembers,
  view,
}) => {
  const { onSelectHandler, allUsers, activeFiltersFlatMap } =
    useUpdatedByFilter({ updatedByHandler, calendarMembers, view });

  return (
    <UserSelectionModal
      display={true}
      onClose={onSelectHandler}
      users={allUsers}
      selectedUsers={activeFiltersFlatMap}
      mode={"single"}
      context="assignees"
      allowDeselect={true}
      title={"Updated By"}
      placeholder="Type user name"
    />
  );
};

export default UpdatedByFilterModal;
