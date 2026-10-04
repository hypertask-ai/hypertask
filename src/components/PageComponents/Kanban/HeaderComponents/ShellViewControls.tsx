'use client'

import { useFlag } from "@/hooks/useFlag"
import { HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG, HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG } from "@/lib/flags/keys"
import Tooltip from "@/components/Common/Tooltip"
import { MobileViewContext } from "@/lib/contexts/mobileContext"
import { useRecoilState, useSetRecoilState } from "@/lib/state"
import { CommandMode } from "@/models/enums"
import { IProject } from "@/models/model"
import { kanbanRunningOnlyAtom, showCommandsAtom } from "@/store"
import { useBoardRunningTimers } from "@/hooks/Task Detail/useTimeTracking"
import {
  getActiveFiltersFromProject,
  getActiveSortingModeFromProject,
  getActiveSortingStackFromProject,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions"
import { ArrowUpDown, Funnel, MoreHorizontal, Timer } from "lucide-react"
import { useContext } from "react"
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext"
import { SaveView } from "./SaveViewHeaderKanban"
import SearchFilter from "./SearchFilter"

const ShellViewControls = ({ project }: { project: IProject }) => {
  const isMbl = useContext(MobileViewContext)
  const { showSearchTasks, toggleSearchTasks } =
    useKanbanModalStatesContext()
  const setShowCommands = useSetRecoilState(showCommandsAtom)
  const [runningOnly, setRunningOnly] = useRecoilState(kanbanRunningOnlyAtom)
  const { timers: runningTimers } = useBoardRunningTimers(project.id)
  const hasActiveFilters =
    getActiveFiltersFromProject(project).addedFilters.length > 0
  const hasActiveSort = getActiveSortingModeFromProject(project) !== "Manual"
  // Tie-break levels are invisible until the popover is open, so surface the total on the icon.
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

export const ViewControlButton = ({
  active = false,
  children,
  keyCombination = [],
  label,
  tooltipText = label,
  onClick,
  tooltipLeft,
  expanded,
  className = "",
}: {
  active?: boolean
  children: React.ReactNode
  keyCombination?: (string | null)[]
  label: string
  tooltipText?: string
  onClick: () => void
  tooltipLeft: number
  expanded?: boolean
  className?: string
}) => {
  const iconControlsEnabled = useFlag(HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG)
  const kanbanReuseEnabled = useFlag(HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG)
  return (
  <button
    type="button"
    aria-label={label}
    aria-expanded={kanbanReuseEnabled || iconControlsEnabled ? expanded : undefined}
    onClick={onClick}
    className={`group relative flex size-8 items-center justify-center transition-colors ${active ? (iconControlsEnabled ? "text-view-control-active hover:text-view-control-active-hover" : kanbanReuseEnabled ? "text-shadcn-primary hover:text-white-black" : "text-[#6FB6FF] hover:text-[#A3D0FF]") : "text-text-light-gray hover:text-white-black"} ${kanbanReuseEnabled || iconControlsEnabled ? className : ""}`}
  >
    {children}
    <Tooltip
      text={tooltipText}
      left={tooltipLeft}
      bottom={-34}
      keyCombination={keyCombination}
    />
  </button>
  )
}

export default ShellViewControls
