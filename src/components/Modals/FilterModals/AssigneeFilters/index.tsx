import {
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { IAgent, IUser } from "@/models/model";
import { ModalBody } from "reactstrap";
import { Bot, Check } from "lucide-react";

import { useAssigneeFilter } from "@/hooks/MultiPages/Filters/useAssigneeFilter";
import MatchModeToggle from "../MatchModeToggle";
import UserAvatar from "@/components/Common/UserAvatar";
import type { CalendarUserSummary } from "@/lib/calendarSync/contract";

type AssigneeOption = IUser | CalendarUserSummary | IAgent;

interface IProps {
  closeHandler: (param?: AssigneeOption) => Promise<void>;
  calendarAssignees?: CalendarUserSummary[];
  view: "Kanban" | "Calendar";
}

const AssigneeFilters = ({ closeHandler, calendarAssignees, view }: IProps) => {
  const {
    keyword,
    onKeyChange,
    selectedIndex,
    setSelectedIndex,
    filteredAssignees,
    enterHandler,
    activeFiltersFlatMap,
  } = useAssigneeFilter({ closeHandler, calendarAssignees, view });
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  function isAgent(entry: AssigneeOption): entry is IAgent {
    return typeof entry.id === "string";
  }

  return (
    <>
      <ModalHeaderComp header="Assignee Filters">
        <MatchModeToggle type="Assignees" noun="assignees" view={view} />
      </ModalHeaderComp>
      <ModalBody className="p-0 rounded-b-[4px] outline-off">
        <ModalInput
          id="filter-input"
          value={keyword}
          placeholder="Enter to (un)select"
          onChange={onKeyChange}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="filteredCommandsList"
        >
          {filteredAssignees?.map((assignee, index) => (
            <ModalRowElementContainer
              key={index}
              onMouseEnter={() => handleMouseEnter(index)}
              handleMouseLeave={handleMouseLeave}
              onClick={enterHandler}
              id={`assignee-htc-option-${index}`}
              index={index}
              commandRef={elRef}
              isSelected={selectedIndex === index}
            >
              <div className="flex-grow flex space-x-2 items-center ">
                <UserAvatar
                  alt=""
                  compactOnMobile
                  name={assignee.displayName ?? undefined}
                  photoURL={assignee.photoURL}
                  size={32}
                  title={assignee.displayName ?? undefined}
                />
                <p className="font-medium ">{assignee.displayName}</p>
                {isAgent(assignee) && (
                  <Bot strokeWidth={1.75} className="mr-1 w-4 h-4" />
                )}
              </div>
              {activeFiltersFlatMap.includes(assignee.id) ? (
                <Check size={16} strokeWidth={1.75} />
              ) : null}
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </>
  );
};

export default AssigneeFilters;
