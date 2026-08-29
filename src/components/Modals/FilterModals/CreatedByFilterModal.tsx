import { FC } from "react";
import UserSelectionModal from "../UserSelectionModal";
import { IUser } from "@/models/model";
import { useCreatedByFilter } from "@/hooks/MultiPages/Filters/useCreatedByFilter";
import type { CalendarUserSummary } from "@/lib/calendarSync/contract";

interface IProps {
  createdByHandler: (param?: IUser | CalendarUserSummary) => Promise<void>;
  calendarMembers?: CalendarUserSummary[];
  view: "Kanban" | "Calendar";
}
const CreatedByFilterModal: FC<IProps> = ({
  createdByHandler,
  calendarMembers,
  view,
}) => {
  const { onSelectHandler, allUsers, activeFiltersFlatMap } =
    useCreatedByFilter({ createdByHandler, calendarMembers, view });

  return (
    <UserSelectionModal
      display={true}
      onClose={onSelectHandler}
      users={allUsers}
      selectedUsers={activeFiltersFlatMap}
      mode={"single"}
      context="createdBy"
      allowDeselect={true}
      title={"Created By"}
      placeholder="Type user name"
    />
  );
};

export default CreatedByFilterModal;
