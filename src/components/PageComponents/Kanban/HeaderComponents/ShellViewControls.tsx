'use client'

import { MobileViewContext } from "@/lib/contexts/mobileContext"
import { useRecoilState, useSetRecoilState, useRecoilValue } from "@/lib/state"
import { CommandMode } from "@/models/enums"
import { IProject } from "@/models/model"
import { boardLayoutAtom, kanbanRunningOnlyAtom, showCommandsAtom, tableSortAccountAtom } from "@/store"
import { useBoardRunningTimers } from "@/hooks/Task Detail/useTimeTracking"
import {
  getActiveFiltersFromProject,
  getActiveSortingModeFromProject,
  getActiveSortingStackFromProject,
  getActiveTableSortStackFromProject,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions"
import { ArrowUpDown, Funnel, Layers, MoreHorizontal, Timer } from "lucide-react"
import OptionPickerModal from "@/components/Modals/OptionPicker"
import { useContext, useEffect, useState } from "react"
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext"
import { SaveView } from "./SaveViewHeaderKanban"
import SearchFilter from "./SearchFilter"
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews"
import { useFlag } from "@/hooks/useFlag"
import {
  effectiveTableGrouping,
  getActiveTableGroupByFromProject,
  type TableGroupBy,
} from "@/lib/table-view/tableGroupByTag"
import Tooltip from "@/components/Common/Tooltip"
import TableTagGroupPicker from "./TableTagGroupPicker"
import { applyTableSortClick } from "@/lib/table-view/tableViewSettings"

const SORT_OPTIONS = [
  { key: "ticket", label: "Ticket" },
  { key: "title", label: "Title" },
  { key: "board", label: "Board" },
  { key: "status", label: "Status" },
  { key: "assignee", label: "Assignee" },
  { key: "priority", label: "Priority" },
  { key: "size", label: "Size" },
  { key: "labels", label: "Labels" },
  { key: "due", label: "Due" },
  { key: "inColumn", label: "In column" },
  { key: "noComment", label: "No comment" },
  { key: "onBoard", label: "On board" },
  { key: "time", label: "Time" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
] as const
const DESC_SORT = new Set<string>(["priority", "size", "time", "created", "updated", "inColumn", "noComment", "onBoard"])

const ShellViewControls = ({ project }: { project: IProject }) => {
  const isMbl = useContext(MobileViewContext)
  const { showSearchTasks, toggleSearchTasks } =
    useKanbanModalStatesContext()
  const setShowCommands = useSetRecoilState(showCommandsAtom)
  const [runningOnly, setRunningOnly] = useRecoilState(kanbanRunningOnlyAtom)
  const boardLayout = useRecoilValue(boardLayoutAtom)
  const tableGroupModesEnabled = useFlag("htpr-8974-table-group-modes")
  const tableGroupByTagEnabled = useFlag("htpr-8630-table-group-by-tag") || tableGroupModesEnabled
  const { setTableGroupByViewAndReturn, setTableSortViewAndReturn } = useKanbanViews(project)
  const tableSortColumnsEnabled = useFlag("htpr-8973-table-sort-columns")
  const sortAccount = useRecoilValue(tableSortAccountAtom)
  const setSortAccount = useSetRecoilState(tableSortAccountAtom)
  const [sortOpen, setSortOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const { timers: runningTimers } = useBoardRunningTimers(project.id)
  const tableGroupBy = tableGroupModesEnabled ? getActiveTableGroupByFromProject(project) : effectiveTableGrouping(project, false, tableGroupByTagEnabled).mode
  const groupByLabel: Record<TableGroupBy, string> = { column: "Column", tag: "Tags", assignee: "Assignee", priority: "Priority", size: "Size" }
  const hasActiveFilters =
    getActiveFiltersFromProject(project).addedFilters.length > 0
  const tableViewId =
    project.project_view?.user_project_views?.[0]?.unsavedView?.id ??
    project.project_view?.user_project_views?.[0]?.appliedView?.id ??
    project.project_view?.default_view?.id
  const tableSortMode = tableSortColumnsEnabled && boardLayout === "table"
  const projectTableSort = getActiveTableSortStackFromProject(project)
  const tableSort = tableSortMode && sortAccount && sortAccount.viewId === tableViewId
    ? sortAccount.sort
    : projectTableSort
  const hasActiveSort = tableSortMode
    ? tableSort.length > 0
    : getActiveSortingModeFromProject(project) !== "Manual"
  const sortLevels = tableSortMode
    ? tableSort.length
    : getActiveSortingStackFromProject(project).length + 1
  useEffect(() => {
    const open = () => setSortOpen(true)
    window.addEventListener("htpr-8973-open-sort", open)
    return () => window.removeEventListener("htpr-8973-open-sort", open)
  }, [])

  if (isMbl) return null
  if (tableSortColumnsEnabled && boardLayout === "table") getActiveTableSortStackFromProject(project)

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
        label={tableSortMode ? "Sort" : "Sort board"}
        tooltipText={tableSortMode && tableSort.length
          ? tableSort.map((level, index) => `${index + 1}. ${level.column} ${level.direction === "asc" ? "▲" : "▼"}`).join(", ")
          : undefined}
        tooltipLeft={-72}
        active={hasActiveSort}
        keyCombination={["SHIFT", "S"]}
        onClick={() => (tableSortColumnsEnabled && boardLayout === "table") ? setSortOpen(true) : openModal(CommandMode.SortKanbanBoard)}
      >
        <ArrowUpDown size={18} strokeWidth={1.75} />
        {sortLevels > 1 && (
          <span className="absolute -right-0.5 -top-0.5 text-[9px] font-semibold leading-none text-[#6FB6FF]">
            {sortLevels}
          </span>
        )}
      </ViewControlButton>
      {sortOpen && tableViewId && (
        <OptionPickerModal
          header="Sort"
          options={SORT_OPTIONS.filter((column) => column.key !== "time" || project.showTimeTotals).map((column) => {
            const level = tableSort.findIndex((item) => item.column === column.key)
            const active = tableSort[level]
            return {
              id: column.key,
              label: column.label,
              hint: active ? `${active.direction === "asc" ? "Ascending" : "Descending"}${level > 0 ? `, ${level + 1}` : ""}` : "Not sorted",
              checked: Boolean(active),
            }
          })}
          onSelect={(option) => {
            const column = option.id
            const next = applyTableSortClick(
              tableSort,
              column,
              false,
              DESC_SORT.has(column) ? "desc" : "asc",
              true,
            )
            setSortAccount({ viewId: tableViewId, sort: next })
            void setTableSortViewAndReturn(project, next[0] ?? null, next)
            setSortOpen(false)
          }}
          onClose={() => setSortOpen(false)}
        />
      )}
      {tableGroupByTagEnabled && boardLayout === "table" && (
        <>
          <ViewControlButton
            label="Group table"
            tooltipText={`Group: ${groupByLabel[tableGroupBy]}`}
            tooltipLeft={-88}
            active={tableGroupBy !== "column"}
            onClick={() => setGroupOpen(true)}
          >
            <Layers size={18} strokeWidth={1.75} />
          </ViewControlButton>
          {groupOpen && (
            <OptionPickerModal
              header="Group by"
              options={[
                { id: "column", label: "Column", hint: "Board columns", checked: tableGroupBy === "column" },
                ...(tableGroupModesEnabled ? [
                  { id: "assignee", label: "Assignee", hint: "Who owns the ticket", checked: tableGroupBy === "assignee" },
                  { id: "priority", label: "Priority", hint: "Urgent first", checked: tableGroupBy === "priority" },
                  { id: "size", label: "Size", hint: "Ticket estimate", checked: tableGroupBy === "size" },
                ] : []),
                { id: "tag", label: "Tags", hint: "Choose which tags", checked: tableGroupBy === "tag" },
              ]}
              onSelect={(option) => {
                if (option.id !== "column" && option.id !== "tag" && option.id !== "assignee" && option.id !== "priority" && option.id !== "size") return
                setGroupOpen(false)
                if (option.id === "tag" && tableGroupModesEnabled) {
                  setTagPickerOpen(true)
                  return
                }
                void setTableGroupByViewAndReturn(project, option.id as TableGroupBy)
              }}
              onClose={() => setGroupOpen(false)}
            />
          )}
          {tagPickerOpen && (
            <TableTagGroupPicker
              project={project}
              onClose={() => setTagPickerOpen(false)}
              onApply={(tagIds) => { setTagPickerOpen(false); void setTableGroupByViewAndReturn(project, "tag", tagIds) }}
            />
          )}
        </>
      )}
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
  return (
  <button
    type="button"
    aria-label={label}
    aria-expanded={expanded}
    onClick={onClick}
    className={`group relative flex size-8 items-center justify-center transition-colors ${active ? "text-view-control-active hover:text-view-control-active-hover" : "text-text-light-gray hover:text-white-black"} ${className}`}
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
