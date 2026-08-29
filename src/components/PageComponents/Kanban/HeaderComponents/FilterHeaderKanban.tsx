import { SlidersHorizontal } from "lucide-react";
import { IProject } from "@/models/model";
import Tooltip from "@/components/Common/Tooltip";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import HeaderIconWrapper from "./HeaderIconWrapper";
import { useSetRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";

const FilterHeader: React.FC<{ currentProject: IProject }> = ({
  currentProject,
}) => {
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const activeFilters =
    getActiveFiltersFromProject(currentProject).addedFilters;
  return (
    <HeaderIconWrapper
      className={activeFilters.length > 0 ? "board-header-icon-active" : undefined}
      onClick={() =>
        setShowCommands({ show: true, mode: CommandMode.ShowFilterHTC })
      }
    >
      <SlidersHorizontal
        size={16}
        strokeWidth={1.75}
        fill="none"
        className={activeFilters.length > 0 ? "text-[#51A4F1]" : "group-hover:text-header-hover-text"}
      />
      <Tooltip
        left={-10}
        bottom={-40}
        text="Show filter options"
        keyCombination={["SHIFT", "F"]}
      />
    </HeaderIconWrapper>
  );
};

export default FilterHeader;
