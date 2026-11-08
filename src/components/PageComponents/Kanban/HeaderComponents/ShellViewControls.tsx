'use client'

import { MobileViewContext } from "@/lib/contexts/mobileContext"
import { useRecoilState, useSetRecoilState, useRecoilValue } from "@/lib/state"
import { CommandMode } from "@/models/enums"
import { IProject } from "@/models/model"
import { boardLayoutAtom, kanbanRunningOnlyAtom, showCommandsAtom } from "@/store"
import { useBoardRunningTimers } from "@/hooks/Task Detail/useTimeTracking"
import {
  getActiveFiltersFromProject,
  getActiveSortingModeFromProject,
  getActiveSortingStackFromProject,
  getActiveTableGroupByFromProject,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions"
import { ArrowUpDown, Funnel, Layers, MoreHorizontal, Timer } from "lucide-react"
import OptionPickerModal from "@/components/Modals/OptionPicker"
import { useContext, useState } from "react"
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext"
import { SaveView } from "./SaveViewHeaderKanban"
import SearchFilter from "./SearchFilter"
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews"
import { useFlag } from "@/hooks/useFlag"
import type { TableGroupBy } from "@/lib/table-view/tableGroupByTag"
import { ViewControlButton } from "./ViewControlButton"

const ShellViewControls = ({ project }: { project: IProject }) => {
  const isMbl = useContext(MobileViewContext)
  const { showSearchTasks, toggleSearchTasks } =
    useKanbanModalStatesContext()
  const setShowCommands = useSetRecoilState(showCommandsAtom)
  const [runningOnly, setRunningOnly] = useRecoilState(kanbanRunningOnlyAtom)
  const boardLayout = useRecoilValue(boardLayoutAtom)
  const tableGroupByTagEnabled = useFlag("htpr-8630-table-group-by-tag")
  const { setTableGroupByViewAndReturn } = useKanbanViews(project)
  const [groupOpen, setGroupOpen] = useState(false)
  const { timers: runningTimers } = useBoardRunningTimers(project.id)
  const tableGroupBy = getActiveTableGroupByFromProject(project)
  const hasActiveFilters =
    getActiveFiltersFromProject(project).addedFilters.length > 0
  const hasActiveSort = getActiveSortingModeFromProject(project) !== "Manual"
  const sortLevels = getActiveSortingStackFromProject(project).length + 1

  if (isMbl) return null

  const openModal = (mode: CommandMode) =>
    setShowCommands({ show: true, mode })

  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {showSearchTasks && (
        <SearchFilter project={project} toggleFilter={toggleSearchTasks} />
      )}
      <SaveView project={project} variant="shell" />
      <ViewControlButton
        label="Filter board"
        tooltipLeft={-74}
        active={hasActiveFilters}
        keyCombination={["SHIFT", "F"]}
        onClick={() => openModal(CommandMode.ShowFilterHTC)}
      >
        <Funnel size={18} strokeWidth={1.75} />
      </ViewControlButton>
      <ViewControlButton
        label="Sort board"
        tooltipLeft={-72}
        active={hasActiveSort}
        keyCombination={["SHIFT", "S"]}
        onClick={() => openModal(CommandMode.SortKanbanBoard)}
      >
        <ArrowUpDown size={18} strokeWidth={1.75} />
        {sortLevels > 1 && (
          <span className="absolute -right-0.5 -top-0.5 text-[9px] font-semibold leading-none text-[#6FB6FF]">
            {sortLevels}
          </span>
        )}
      </ViewControlButton>
      {tableGroupByTagEnabled ? (
        boardLayout === "table" ? (
        <>
          <ViewControlButton
            label="Group table"
            tooltipText={`Group: ${tableGroupBy === "tag" ? "Tag" : "Column"}`}
            tooltipLeft={-88}
            active={tableGroupBy === "tag"}
            onClick={() => setGroupOpen(true)}
          >
            <Layers size={18} strokeWidth={1.75} />
          </ViewControlButton>
          {groupOpen && (
            <OptionPickerModal
              header="Group by"
              options={[
                { id: "column", label: "Column", hint: "Board columns", checked: tableGroupBy === "column" },
                { id: "tag", label: "Tag", hint: "One group per label", checked: tableGroupBy === "tag" },
              ]}
              onSelect={(option) => {
                if (option.id !== "column" && option.id !== "tag") return
                setGroupOpen(false)
                void setTableGroupByViewAndReturn(project, option.id as TableGroupBy)
              }}
              onClose={() => setGroupOpen(false)}
            />
          )}
        </>
        ) : null
      ) : null}
      {project.timeTrackingEnabled && (
        <ViewControlButton
          label="Show only tasks with a running timer"
          tooltipLeft={-190}
          active={runningOnly}
          onClick={() => setRunningOnly((value) => !value)}
        >
          <Timer size={18} strokeWidth={1.75} />
          {runningTimers.size > 0 && (
            <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-[#6FB6FF] px-1 text-center text-[9px] font-semibold leading-[14px] text-black">
              {runningTimers.size}
            </span>
          )}
        </ViewControlButton>
      )}
      <ViewControlButton
        label="Board menu"
        tooltipLeft={-88}
        onClick={() =>
          setShowCommands({
            show: true,
            mode: CommandMode.Command,
            scope: "board",
          })
        }
      >
        <MoreHorizontal size={18} strokeWidth={1.75} />
      </ViewControlButton>
    </div>
  )
}

export { ViewControlButton } from "./ViewControlButton"

export default ShellViewControls
