/* eslint-disable react/jsx-key */
import {
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import { useEffect, useMemo, FC } from "react";
import {
  IFilter,
  IFilterCommandRowEl,
  IFilterModalProps,
  TMatchFilters,
  supportsMatchMode,
} from "@/models/Filters/model";
import { ModalBody } from "reactstrap";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { formatDateDisplay } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { useFilterView } from "@/hooks/MultiPages/Filters/useFilterView";

const ShowFilterOptions: React.FC<IFilterModalProps> = ({
  handleAction,
  toggleFilterMatchOptions,
  view,
}) => {
  const {
    keyword,
    onKeyChange,
    selectedIndex,
    setSelectedIndex,
    filteredCommands,
    activeFilters,
  } = useFilterView(view);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  const onClickOrEnterHandler = (idx: number) => {
    setTimeout(() => handleAction(filteredCommands[idx].commandMode), 20);
  };

  const keyDownHandler = (e: KeyboardEvent) => {
    if (e.keyCode === KeyCodes.ENTER && filteredCommands[selectedIndex])
      onClickOrEnterHandler(selectedIndex);

    if (e.keyCode === KeyCodes.ARROW_LEFT) {
      e.preventDefault();
      toggleFilterMatchOptions();
    }

    if (e.keyCode === KeyCodes.ARROW_RIGHT) {
      e.preventDefault();
      toggleFilterMatchOptions();
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", keyDownHandler);
    return () => {
      document.removeEventListener("keydown", keyDownHandler);
    };
  }, [keyword, filteredCommands, selectedIndex, toggleFilterMatchOptions]);

  return (
    <>
      <ModalHeaderComp header="Filters">
        <ToggleFilterType
          selectedOption={activeFilters.matchFilters}
          handleFilterChange={toggleFilterMatchOptions}
        />
      </ModalHeaderComp>
      <ModalBody className="p-0 rounded-b-[4px]">
        <ModalInput
          id="filter-input"
          value={keyword}
          placeholder="Enter to (un)select"
          onChange={onKeyChange}
        />
        <ModalListContainer className="max-h-[364px]"
          handleMouseMove={handleMouseMove}
          id="filteredCommandsList"
        >
          {filteredCommands?.map((filter, index) => {
            return (
              <ModalRowElementContainer
                onMouseEnter={() => handleMouseEnter(index)}
                handleMouseLeave={handleMouseLeave}
                onClick={onClickOrEnterHandler}
                id={`filter-htc-option-${index}`}
                index={index}
                commandRef={elRef}
                isSelected={selectedIndex === index}
              >
                <FilterCommandRowEl el={filter} activeFilters={activeFilters} view={view} />
              </ModalRowElementContainer>
            );
          })}
        </ModalListContainer>
      </ModalBody>
    </>
  );
};

// Exported so a filter's own value picker can show the identical control for its own values,
// instead of growing a second look for the same idea.
export const ToggleFilterType = ({
  selectedOption,
  handleFilterChange,
  noun = "Filters",
}: {
  selectedOption: TMatchFilters;
  handleFilterChange: (filter: TMatchFilters) => void;
  noun?: string;
}) => {
  return (
    <div
      className="text-meta cursor-pointer items-center text-white-black text-nowrap"
      onClick={() =>
        handleFilterChange(selectedOption === "ALL" ? "ANY" : "ALL")
      }
    >
      <span>Match {selectedOption === "ALL" ? "ALL" : "ANY"} {noun}</span>
    </div>
  );
};

const FilterCommandRowEl: React.FC<IFilterCommandRowEl & { view: "Kanban" | "Calendar" }> = ({
  el,
  activeFilters,
  view,
}) => {
  const currentlyActive = activeFilters.addedFilters.find(
    (filter) => filter.type === el.type
  );

  return (
    <>
      <span>{el.name}</span>

      {currentlyActive && view === "Kanban" && (
        <RenderActiveFilters elKey={el.key} currentlyActive={currentlyActive} />
      )}
    </>
  );
};

interface RenderActiveFiltersProps {
  elKey: string;
  currentlyActive: IFilter;
}
const RenderActiveFilters: FC<RenderActiveFiltersProps> = ({
  currentlyActive,
  elKey,
}) => {
  const currentUser = useRecoilValue(currentUserAtom);
  const getPayloadToDisplay = (currentlyActive: IFilter) => {
    let payload: any[];
    switch (currentlyActive.type) {
      case "Assignees":
      case "BlockedByPerson":
      case "UpdatedBy":
      case "CreatedBy":
        if (elKey === "AssigneeToMe") {
          // If the current user is present in the payload, just return "Active"
          if (
            currentlyActive.searchPayload &&
            currentlyActive.searchPayload.some(
              (x: any) => x.id === currentUser?.id
            ) // Assuming 1 is the current user's ID
          ) {
            return "Active";
          }
          return;
        } else {
          payload = currentlyActive.searchPayload.map((x) => x.displayName);
        }
        break;
      case "Labels":
        payload = currentlyActive.searchPayload.map((x) => x.value);
        break;
      case "Size":
        payload = currentlyActive.searchPayload.map((x) => x.estimate_value);
        break;
      case "Priority":
        payload = currentlyActive.searchPayload.map((x) => x.Priority_Value);
        break;
      case "DueDate":
      case "CreatedAt":
      case "UpdatedRange":
        return formatDateDisplay(currentlyActive.searchPayload);
      default:
        return "Active";
    }
    if (payload && payload.length > 3) {
      return `${payload.slice(0, 3).join(", ")} +${payload.length - 3} more`;
    } else if (payload) {
      return payload.join(", ");
    }
    return "Active";
  };

  const displayText = useMemo(
    () => getPayloadToDisplay(currentlyActive),
    [currentlyActive, elKey, currentUser]
  );

  if (!displayText) return null;
  return (
    <span className="text-micro font-medium">
      {displayText}
      {/* ANY is the default and stays unlabelled — only ALL needs announcing. */}
      {supportsMatchMode(currentlyActive.type) && currentlyActive.match === "ALL" && (
        <span className="ml-1 text-text-light-gray">· ALL</span>
      )}
    </span>
  );
};

export default ShowFilterOptions;
