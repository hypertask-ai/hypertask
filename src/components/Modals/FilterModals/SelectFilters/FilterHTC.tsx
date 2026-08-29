import { FilterCommandMode } from "@/models/Filters/enums";
import { useEffect, useState } from "react";
import ShowFilterOptions from "./ShowFilterOptionsModal";
import {
  IValuePropUpdatedAt,
  TFilter,
  TFilterCommandComponents,
} from "@/models/Filters/model";
import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import styles from "@/styles/linksModal.module.scss";
import useFilters from "@/hooks/Homepage/Filters/useFilters";
import SetPriorityModal from "../../TaskPriority";
import {
  IEstimateConstants,
  IPrioritiesConstants,
} from "@/lib/constants/constants";
import TaskEstimateModal from "../../TaskEstimate/TaskEstimate";
import TagsFilterModal from "@/components/Modals/FilterModals/TagsFilter/TagsFilterModal";
import AssigneeFilters from "../AssigneeFilters";
import BlockedByPersonFilters from "../BlockedByPersonFilters";
import UpdatedAtRangeFilterModal from "../UpdatedAtRange";
import UpdatedByFilterModal from "../UpdatedByFilterModal";
import CreatedByFilterModal from "../CreatedByFilterModal";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { calendarTaskFiltersAtom, currentUserAtom } from "@/store";
import { IAgent, ILabel, IProject, IUser } from "@/models/model";
import type {
  CalendarLabelSummary,
  CalendarUserSummary,
} from "@/lib/calendarSync/contract";

interface Props {
  toggle: () => void;
  view: "Kanban" | "Calendar";
  filteredMembers?: CalendarUserSummary[];
  allTags?: CalendarLabelSummary[];
}

const AllFilterHTC: React.FC<Props> = ({
  toggle,
  view,
  filteredMembers,
  allTags,
}) => {
  const [commandMode, setCommandMode] = useState<FilterCommandMode>(
    FilterCommandMode.ShowAllFilters,
  );
  const currentUser = useRecoilValue(currentUserAtom);
  const setCalendarTaskFilters = useSetRecoilState(calendarTaskFiltersAtom);
  const {
    addFilter,
    resetFilters,
    toggleFilterMatchOptions,
    overrideFilter,
    removeFilter,
  } = useFilters();

  const handleAction = (mode?: FilterCommandMode) => {
    if (mode) setCommandMode(mode);

    switch (mode) {
      case FilterCommandMode.InInbox:
        if (view === "Calendar") break;
        addFilter("Inbox", { id: 0 });
        break;
      case FilterCommandMode.Unread:
        if (view === "Calendar") break;
        addFilter("Unread", { id: 0 });
        break;
      case FilterCommandMode.NoRecentComment:
        if (view === "Calendar") break;
        addFilter("NoRecentComment", { id: 0 });
        break;
      case FilterCommandMode.StuckInColumn:
        if (view === "Calendar") break;
        addFilter("StuckInColumn", { id: 0 });
        break;
      case FilterCommandMode.RunningTimer:
        if (view === "Calendar") break;
        addFilter("RunningTimer", { id: 0 });
        break;
      case FilterCommandMode.StaleOnBoard:
        if (view === "Calendar") break;
        addFilter("StaleOnBoard", { id: 0 });
        break;
      case FilterCommandMode.NotStale:
        if (view === "Calendar") break;
        addFilter("NotStale", { id: 0 });
        break;
      case FilterCommandMode.ClearAll:
        if (view === "Calendar") {
          console.log("Clearing calendar filters");
          setCalendarTaskFilters((prev) => ({
            ...prev,
            assignedToMe: false,
            updatedBy: [],
            createdBy: [],
            priority: [],
            assignees: [],
            assigneeAgents: [],
            updatedByAgents: [],
            labels: [],
            size: [],
          }));
        } else {
          resetFilters();
        }
        boardCloseHandler();
        break;
      case FilterCommandMode.ToggleMatchCriterai:
        if (view === "Calendar") {
          setCalendarTaskFilters((prev) => ({
            ...prev,
            matchFilters: prev.matchFilters === "ALL" ? "ANY" : "ALL",
          }));
        } else {
          toggleFilterMatchOptions();
        }
        break;
      case FilterCommandMode.AssignedToMe:
        if (view === "Calendar") {
          setCalendarTaskFilters((prev) => {
            return {
              ...prev,
              assignedToMe: !prev.assignedToMe,
            };
          });
        } else {
          addFilterElseClose("Assignees", currentUser);
        }
        break;
      case FilterCommandMode.Starred:
        addFilterElseClose("Starred", currentUser);
        break;
    }
  };

  const addFilterElseClose = async (type: TFilter, value: any) => {
    if (view === "Calendar") {
      if (type === "Priority") {
        setCalendarTaskFilters((prev) => {
          const alreadyPresent = prev.priority.includes(value.priority_index);
          return {
            ...prev,
            priority: alreadyPresent
              ? prev.priority.filter((idx) => idx !== value.priority_index)
              : [...prev.priority, value.priority_index],
          };
        });
      } else if (type === "Size") {
        setCalendarTaskFilters((prev) => {
          const alreadyPresent = prev.size.includes(value.estimate_index);
          return {
            ...prev,
            size: alreadyPresent
              ? prev.size.filter((idx) => idx !== value.estimate_index)
              : [...prev.size, value.estimate_index],
          };
        });
      } else if (type === "Assignees") {
        if (typeof value.id === "string") {
          const agentId = value.id as string;
          setCalendarTaskFilters((prev) => ({
            ...prev,
            assigneeAgents: prev.assigneeAgents.includes(agentId)
              ? prev.assigneeAgents.filter((id) => id !== agentId)
              : [...prev.assigneeAgents, agentId],
          }));
        } else {
          setCalendarTaskFilters((prev) => ({
            ...prev,
            assignees: prev.assignees.includes(value.id)
              ? prev.assignees.filter((id) => id !== value.id)
              : [...prev.assignees, value.id],
          }));
        }
      } else if (type === "UpdatedBy") {
        if (typeof value.id === "string") {
          const agentId = value.id as string;
          setCalendarTaskFilters((prev) => ({
            ...prev,
            updatedByAgents: prev.updatedByAgents.includes(agentId)
              ? prev.updatedByAgents.filter((id) => id !== agentId)
              : [...prev.updatedByAgents, agentId],
          }));
        } else {
          setCalendarTaskFilters((prev) => ({
            ...prev,
            updatedBy: prev.updatedBy.includes(value.id)
              ? prev.updatedBy.filter((id) => id !== value.id)
              : [...prev.updatedBy, value.id],
          }));
        }
      } else if (type === "CreatedBy") {
        setCalendarTaskFilters((prev) => ({
          ...prev,
          createdBy: prev.createdBy.includes(value.id)
            ? prev.createdBy.filter((id) => id !== value.id)
            : [...prev.createdBy, value.id],
        }));
      } else if (type === "Labels") {
        setCalendarTaskFilters((prev) => {
          return {
            ...prev,
            labels: prev.labels.includes(value.id)
              ? prev.labels.filter((id) => id !== value.id)
              : [...prev.labels, value.id],
          };
        });
      }
      return;
    } else if (value) await addFilter(type, value);
    else boardCloseHandler();
  };

  const updatedAtHandler = (
    param?: IValuePropUpdatedAt | null,
    reset?: boolean,
  ) => {
    reset
      ? removeFilter("UpdatedRange")
      : overrideFilter("UpdatedRange", { id: 1, ...param });
    setCommandMode(FilterCommandMode.ShowAllFilters);
  };

  const createdAtHandler = (
    param?: IValuePropUpdatedAt | null,
    reset?: boolean,
  ) => {
    reset
      ? removeFilter("CreatedAt")
      : overrideFilter("CreatedAt", { id: 1, ...param });
    setCommandMode(FilterCommandMode.ShowAllFilters);
  };

  const dueDateHandler = (
    param?: IValuePropUpdatedAt | null,
    reset?: boolean,
  ) => {
    reset
      ? removeFilter("DueDate")
      : overrideFilter("DueDate", { id: 1, ...param });
    setCommandMode(FilterCommandMode.ShowAllFilters);
  };

  const updatedByHandler = async (
    param?: IUser | CalendarUserSummary | IAgent,
  ) => {
    addFilterElseClose("UpdatedBy", param);
    setCommandMode(FilterCommandMode.ShowAllFilters);
  };

  const createdByHandler = async (param?: IUser | CalendarUserSummary) => {
    addFilterElseClose("CreatedBy", param);
    setCommandMode(FilterCommandMode.ShowAllFilters);
  };

  const toggleFilterMatchOptionsHandler = () => {
    if (view === "Calendar") {
      setCalendarTaskFilters((prev) => ({
        ...prev,
        matchFilters: prev.matchFilters === "ALL" ? "ANY" : "ALL",
      }));
    } else {
      toggleFilterMatchOptions();
    }
  };

  const commandComponents: TFilterCommandComponents = {
    [FilterCommandMode.ShowAllFilters]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.InInbox]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.Labels]: (
      <TagsFilterModal
        closeHandler={(param) => addFilterElseClose("Labels", param)}
        calendarTags={allTags}
        view={view}
      />
    ),
    [FilterCommandMode.Priority]: (
      <SetPriorityModal
        mode={view === "Calendar" ? "Filter-Calendar" : "Filter"}
        closeHandler={(param?: IPrioritiesConstants) =>
          addFilterElseClose(
            "Priority",
            param && { id: param.priority_index, ...param },
          )
        }
      />
    ),
    [FilterCommandMode.Unread]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.NoRecentComment]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.StuckInColumn]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.RunningTimer]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.StaleOnBoard]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.NotStale]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.Size]: (
      <TaskEstimateModal
        mode={view === "Calendar" ? "Filter-Calendar" : "Filter"}
        closeHandler={(param?: IEstimateConstants) =>
          addFilterElseClose(
            "Size",
            param && { id: param.estimate_index, ...param },
          )
        }
      />
    ),
    [FilterCommandMode.ClearAll]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.ToggleMatchCriterai]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.Assignees]: (
      <AssigneeFilters
        closeHandler={(param) => addFilterElseClose("Assignees", param)}
        calendarAssignees={filteredMembers}
        view={view}
      />
    ),
    [FilterCommandMode.BlockedByPerson]: (
      <BlockedByPersonFilters
        closeHandler={(user) => addFilterElseClose("BlockedByPerson", user)}
      />
    ),
    [FilterCommandMode.UpdatedRange]: (
      <UpdatedAtRangeFilterModal
        mode="updatedAt"
        closeHandler={updatedAtHandler}
      />
    ),
    [FilterCommandMode.CreatedAt]: (
      <UpdatedAtRangeFilterModal
        mode="createdAt"
        closeHandler={createdAtHandler}
      />
    ),
    [FilterCommandMode.DueDate]: (
      <UpdatedAtRangeFilterModal mode="dueDate" closeHandler={dueDateHandler} />
    ),
    [FilterCommandMode.AssignedToMe]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.Starred]: (
      <ShowFilterOptions
        handleAction={handleAction}
        toggleFilterMatchOptions={toggleFilterMatchOptionsHandler}
        view={view}
      />
    ),
    [FilterCommandMode.UpdatedBy]: (
      <UpdatedByFilterModal
        updatedByHandler={(param) => updatedByHandler(param)}
        calendarMembers={filteredMembers}
        view={view}
      />
    ),
    [FilterCommandMode.CreatedBy]: (
      <CreatedByFilterModal
        createdByHandler={(param) => createdByHandler(param)}
        calendarMembers={filteredMembers}
        view={view}
      />
    ),
  };

  const boardCloseHandler = () => {
    setTimeout(() => {
      setCommandMode(0);
      toggle();
    }, 1);
  };

  const keyDownHandler = (e: KeyboardEvent) => {
    if (e.keyCode === KeyCodes.ESCAPE && e.shiftKey) {
      e.preventDefault();
      setCommandMode(FilterCommandMode.ShowAllFilters);
    }
    // [shift] + [f]
    if (e.keyCode === KeyCodes.ESCAPE && !e.shiftKey) {
      e.preventDefault();
      boardCloseHandler();
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", keyDownHandler);
    return () => {
      document.removeEventListener("keydown", keyDownHandler);
    };
  }, [commandMode]);

  return (
    <ModalContainerCustom
      animation={false}
      id="filter-container-HTC"
      isOpen={true}
      toggle={boardCloseHandler}
      keyboard={false}
      shouldCloseOnClickOutside={true}
      className={`paletteModalSizing ${styles.links_modal} sm:min-w-[560px] sm:top-[24%] sm:max-h-[464px]`}
    >
      {commandComponents[commandMode]}
    </ModalContainerCustom>
  );
};

export default AllFilterHTC;
