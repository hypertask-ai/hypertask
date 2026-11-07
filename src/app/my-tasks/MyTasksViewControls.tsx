"use client";

import type { ReactNode } from "react";
import { ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import { ViewControlButton } from "@/components/PageComponents/Kanban/HeaderComponents/ShellViewControls";
import MyTasksInvolvementPicker from "./MyTasksInvolvementPicker";
import MyTasksGroupPicker from "./MyTasksGroupPicker";
import MyTasksSortPicker from "./MyTasksSortPicker";
import AssignModal from "@/components/Modals/AssignToUser/AssignToUser";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import { useFlag } from "@/hooks/useFlag";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import {
  HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG,
  MY_TASKS_SNOOZE_FLAG,
} from "@/lib/flags/keys";
import {
  MY_TASKS_SCOPE_VALUES,
  normalizeMyTasksScopes,
  type MyTasksScope,
} from "@/lib/myTasksScopes";
import { myTasksParityFilterCount } from "@/lib/filterSettingsMutations";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  effectiveMyTasksGroupBy,
  effectiveMyTasksTableVisibleColumns,
  type MyTasksBoardMetadata,
  type MyTasksViewConfig,
} from "@/models/MyTasksView";
import { DEFAULT_MY_TASKS_TABLE_COLUMNS } from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";
import { Check, ArrowUpDown, Columns3, Layers, LayoutGrid, SlidersHorizontal, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  variant?: "icons" | "labels";
  boards: MyTasksBoardMetadata[];
  config: MyTasksViewConfig;
  onChange: (config: MyTasksViewConfig) => void;
  onOpenKanbanFilters?: () => void;
  tableColumnsEnabled?: boolean;
  onOpenTableColumns?: () => void;
  snoozeEnabled?: boolean;
}



export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <section className="space-y-1.5">
    <p className="text-meta font-semibold text-text-light-gray">{label}</p>
    {children}
  </section>
);

export const CheckRow = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) => {
  return (
    <ModalRowElementContainer
      isSelected={false}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={onChange}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onChange();
        }
      }}
    >
      <span>{label}</span>
      {checked && <Check size={16} strokeWidth={1.75} />}
    </ModalRowElementContainer>
  );
};


const MyTasksViewControls = ({
  variant = "labels",
  boards,
  config,
  onChange,
  onOpenKanbanFilters,
  tableColumnsEnabled = false,
  onOpenTableColumns,
  snoozeEnabled: snoozeEnabledProp = false,
}: Props) => {
  const iconControlsFlag = useFlag(HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG);
  const iconControlsEnabled = iconControlsFlag && variant === "icons";
  const myTasksSnoozeFlag = useFlag(MY_TASKS_SNOOZE_FLAG);
  const snoozeEnabled = Boolean(myTasksSnoozeFlag && snoozeEnabledProp);
  const myTasksScopesEnabled = true;
  const [scopeOpen, setScopeOpen] = useState(false);
  const [involvementOpen, setInvolvementOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  const involvementRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  useClickOutside(scopeRef, () => setScopeOpen(false));
  useClickOutside(involvementRef, () => setInvolvementOpen(false));
  useClickOutside(sortRef, () => setSortOpen(false));
  useClickOutside(groupRef, () => setGroupOpen(false));

  useEffect(() => {
    const openScope = () => {
      setScopeOpen(true);
      setInvolvementOpen(false);
      setSortOpen(false);
      setGroupOpen(false);
    };
    window.addEventListener("my-tasks-scope-picker", openScope);
    return () => window.removeEventListener("my-tasks-scope-picker", openScope);
  }, []);

  useEffect(() => {
    const openPicker = (picker: "involvement" | "sort" | "group") => {
      setScopeOpen(false);
      setInvolvementOpen(picker === "involvement" && myTasksScopesEnabled);
      setSortOpen(picker === "sort");
      setGroupOpen(picker === "group");
    };
    const openInvolvement = () => openPicker("involvement");
    const openSort = () => openPicker("sort");
    const openGroup = () => openPicker("group");
    window.addEventListener("my-tasks-involvement-picker", openInvolvement);
    window.addEventListener("my-tasks-sort-picker", openSort);
    window.addEventListener("my-tasks-group-picker", openGroup);
    return () => {
      window.removeEventListener("my-tasks-involvement-picker", openInvolvement);
      window.removeEventListener("my-tasks-sort-picker", openSort);
      window.removeEventListener("my-tasks-group-picker", openGroup);
    };
  }, [myTasksScopesEnabled]);

  const scopes = normalizeMyTasksScopes(config.scopes);
  const involvementCount =
    scopes.length === 1 && scopes[0] === "assigned" ? 0 : scopes.length;

  const toggleScope = (scope: MyTasksScope) => {
    const selected = new Set(scopes);
    if (selected.has(scope)) {
      selected.delete(scope);
    } else {
      selected.add(scope);
    }
    const next = MY_TASKS_SCOPE_VALUES.filter((value) => selected.has(value));
    onChange({
      ...config,
      scopes: next.length > 0 ? next : ["assigned"],
    });
  };

  const groupBy = effectiveMyTasksGroupBy(config);

  const selectedBoardIds = config.boardIds ?? boards.map((board) => board.id);
  const kanbanFilterCount = myTasksParityFilterCount(config) + [
    config.filters.sectionIds.length > 0,
    config.filters.showDone,
    snoozeEnabled && config.filters.showSnoozed,
  ].filter(Boolean).length;
  const scopeCount = Number(config.boardIds !== null);
  const setBoards = (boardIds: number[] | null) => {
    const effectiveIds = boardIds ?? boards.map((board) => board.id);
    const availableBoards = boards.filter((board) => effectiveIds.includes(board.id));
    const allowedSections = new Set(
      availableBoards.flatMap((board) => board.sections.map((section) => section.id)),
    );
    const allowedLabels = new Set(
      availableBoards.flatMap((board) => board.labels.map((label) => label.id)),
    );
    onChange({
      ...config,
      boardIds,
      filters: {
        ...config.filters,
        sectionIds: config.filters.sectionIds.filter((id) => allowedSections.has(id)),
        labelIds: config.filters.labelIds.filter((id) => allowedLabels.has(String(id))),
      },
    });
  };

  const toggleBoard = (boardId: number) => {
    const current = config.boardIds ?? boards.map((board) => board.id);
    const next = current.includes(boardId)
      ? current.filter((id) => id !== boardId)
      : [...current, boardId];
    setBoards(next.length === boards.length ? null : next);
  };

  const closeOtherMenus = () => {
    setScopeOpen(false);
    setInvolvementOpen(false);
    setSortOpen(false);
    setGroupOpen(false);
  };

  return (
    <div
      className={
        myTasksScopesEnabled
          ? `ml-auto flex min-w-0 max-w-full flex-1 flex-wrap items-center justify-end ${iconControlsEnabled ? "gap-2" : "gap-1"}`
          : `ml-auto flex shrink-0 items-center ${iconControlsEnabled ? "gap-2" : "gap-1"}`
      }
    >
      {myTasksScopesEnabled ? (
        <div ref={involvementRef} className="relative">
          {iconControlsEnabled ? (
            <ViewControlButton
              label="My Tasks involvement"
              tooltipText="Involvement"
              tooltipLeft={-72}
              className={`${MOBILE_TARGET} @md:min-h-0 @md:min-w-0`}
              active={involvementCount > 0}
              expanded={involvementOpen}
              onClick={() => {
                setInvolvementOpen((open) => !open);
                setScopeOpen(false);
                setSortOpen(false);
                setGroupOpen(false);
                        }}
            >
              <UserRound size={18} strokeWidth={1.75} />
              {involvementCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 text-micro font-semibold leading-none">{involvementCount}</span>
              )}
            </ViewControlButton>
          ) : (
          <button
            type="button"
            aria-label="My Tasks involvement"
            aria-expanded={involvementOpen}
            onClick={() => {
              setInvolvementOpen((open) => !open);
              setScopeOpen(false);
              setSortOpen(false);
              setGroupOpen(false);
                    }}
            className={`${MOBILE_TARGET} h-8 gap-1.5 rounded-[4px] px-2 text-content transition-colors hover:bg-hover-active @md:min-h-0 @md:min-w-0 ${
              involvementCount > 0
                ? "text-shadcn-primary"
                : "text-text-light-gray hover:text-white-black"
            }`}
          >
            <UserRound size={16} strokeWidth={1.5} />
            <span className="hidden @md:inline">Involvement</span>
            {involvementCount > 0 && (
              <span className="text-meta font-semibold">{involvementCount}</span>
            )}
          </button>
          )}
          {involvementOpen && (
            <MyTasksInvolvementPicker scopes={scopes} onToggle={toggleScope} onClose={() => setInvolvementOpen(false)} />
          )}
        </div>
      ) : null}
      {tableColumnsEnabled && onOpenTableColumns ? (
        iconControlsEnabled ? (
            <ViewControlButton
              label="Configure table columns"
              tooltipText="Columns"
              tooltipLeft={-72}
              className={`${MOBILE_TARGET} @md:min-h-0 @md:min-w-0`}
              active={JSON.stringify(effectiveMyTasksTableVisibleColumns(config)) !== JSON.stringify(DEFAULT_MY_TASKS_TABLE_COLUMNS)}
              onClick={() => {
                closeOtherMenus();
                onOpenTableColumns();
              }}
            >
              <Columns3 size={18} strokeWidth={1.75} />
            </ViewControlButton>
          ) : (
          <button
          type="button"
          aria-label="Configure table columns"
          onClick={() => {
            closeOtherMenus();
            onOpenTableColumns();
          }}
          className={`${MOBILE_TARGET} h-8 gap-1.5 rounded-[4px] px-2 text-content text-text-light-gray transition-colors hover:bg-hover-active hover:text-white-black @md:min-h-0 @md:min-w-0`}
        >
          <Columns3 size={16} strokeWidth={1.5} />
          <span className="hidden @md:inline">Columns</span>
        </button>
        )
      ) : null}
        <>
          <div ref={scopeRef} className="relative">
            {iconControlsEnabled ? (
            <ViewControlButton
              label="My Tasks scope"
              tooltipText="Scope"
              tooltipLeft={-72}
              className={`${MOBILE_TARGET} @md:min-h-0 @md:min-w-0`}
              active={config.boardIds !== null && (selectedBoardIds.length !== boards.length || boards.some((board) => !selectedBoardIds.includes(board.id)))}
              expanded={scopeOpen}
              onClick={() => {
                setScopeOpen((open) => !open);
                setInvolvementOpen(false);
                setSortOpen(false);
                setGroupOpen(false);
              }}
            >
              <LayoutGrid size={18} strokeWidth={1.75} />
              {scopeCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 text-micro font-semibold leading-none">{scopeCount}</span>
              )}
            </ViewControlButton>
          ) : (
          <button
              type="button"
              aria-label="My Tasks scope"
              aria-expanded={scopeOpen}
              onClick={() => {
                setScopeOpen((open) => !open);
                setInvolvementOpen(false);
                setSortOpen(false);
                setGroupOpen(false);
              }}
              className={`${MOBILE_TARGET} h-8 gap-1.5 rounded-[4px] px-2 text-content transition-colors hover:bg-hover-active @md:min-h-0 @md:min-w-0 ${
                scopeCount > 0
                  ? "text-shadcn-primary"
                  : "text-text-light-gray hover:text-white-black"
              }`}
            >
              <LayoutGrid size={16} strokeWidth={1.5} />
              <span className="hidden @md:inline">Scope</span>
              {scopeCount > 0 && (
                <span className="text-meta font-semibold">{scopeCount}</span>
              )}
            </button>
          )}
            {scopeOpen && (
              <AssignModal
                assignees={[]}
                title="Scope"
                onClose={() => setScopeOpen(false)}
                boardPicker={{
                  options: [
                    { id: null, label: "All boards", checked: config.boardIds === null },
                    ...boards.map((board) => ({ id: board.id, label: board.title, checked: selectedBoardIds.includes(board.id) })),
                  ],
                  onSelect: (id) => id === null ? setBoards(config.boardIds === null ? [] : null) : toggleBoard(id),
                }}
              />
            )}
          </div>

          {iconControlsEnabled ? (
            <ViewControlButton
              label="Filter My Tasks"
              tooltipText="Filters"
              tooltipLeft={-72}
              className={`${MOBILE_TARGET} @md:min-h-0 @md:min-w-0`}
              active={kanbanFilterCount > 0}
              onClick={() => {
                setScopeOpen(false);
                setInvolvementOpen(false);
                setSortOpen(false);
                setGroupOpen(false);
                onOpenKanbanFilters?.();
              }}
            >
              <SlidersHorizontal size={18} strokeWidth={1.75} />
              {kanbanFilterCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 text-micro font-semibold leading-none">{kanbanFilterCount}</span>
              )}
            </ViewControlButton>
          ) : (
          <button
            type="button"
            aria-label="Filter My Tasks"
            onClick={() => {
              setScopeOpen(false);
              setInvolvementOpen(false);
              setSortOpen(false);
              setGroupOpen(false);
              onOpenKanbanFilters?.();
            }}
            className={`${MOBILE_TARGET} h-8 gap-1.5 rounded-[4px] px-2 text-content transition-colors hover:bg-hover-active @md:min-h-0 @md:min-w-0 ${
              kanbanFilterCount > 0
                ? "text-shadcn-primary"
                : "text-text-light-gray hover:text-white-black"
            }`}
          >
            <SlidersHorizontal size={16} strokeWidth={1.5} />
            <span className="hidden @md:inline">Filters</span>
            {kanbanFilterCount > 0 && (
              <span className="text-meta font-semibold">{kanbanFilterCount}</span>
            )}
          </button>
          )}
        </>
      <div ref={sortRef} className="relative">
        <ViewControlButton
          label="Sort My Tasks"
          tooltipText={iconControlsEnabled ? "Sort" : "Sort My Tasks"}
          tooltipLeft={-72}
          className={`${MOBILE_TARGET} @md:min-h-0 @md:min-w-0`}
          active={
            config.sort.field !== DEFAULT_MY_TASKS_VIEW_CONFIG.sort.field ||
            config.sort.direction !== DEFAULT_MY_TASKS_VIEW_CONFIG.sort.direction
          }
          expanded={sortOpen}
          onClick={() => {
            closeOtherMenus();
            setSortOpen(!sortOpen);
          }}
        >
          <ArrowUpDown size={18} strokeWidth={1.75} />
        </ViewControlButton>
        {sortOpen && (
          <MyTasksSortPicker sort={config.sort} onSortChange={(sort) => onChange({ ...config, sort })} onClose={() => setSortOpen(false)} />
        )}
      </div>

      <div ref={groupRef} className="relative hidden @md:block">
        {iconControlsEnabled ? (
          <ViewControlButton
            label="Group My Tasks"
            tooltipText={`Group: ${groupBy === "time" ? "Due date" : "Board"}`}
            tooltipLeft={-72}
            className={`${MOBILE_TARGET} @md:min-h-0 @md:min-w-0`}
            active={groupBy !== effectiveMyTasksGroupBy(DEFAULT_MY_TASKS_VIEW_CONFIG)}
            expanded={groupOpen}
            onClick={() => {
              setGroupOpen((open) => !open);
                      setScopeOpen(false);
              setInvolvementOpen(false);
              setSortOpen(false);
            }}
          >
            <Layers size={18} strokeWidth={1.75} />
          </ViewControlButton>
        ) : (
        <button
          type="button"
          aria-label="Group My Tasks"
          aria-expanded={groupOpen}
          onClick={() => {
            setGroupOpen((open) => !open);
                  setScopeOpen(false);
            setInvolvementOpen(false);
            setSortOpen(false);
          }}
          className={`${MOBILE_TARGET} h-8 gap-1.5 rounded-[4px] px-2 text-content transition-colors hover:bg-hover-active @md:min-h-0 @md:min-w-0 ${
            groupBy === "time"
              ? "text-shadcn-primary"
              : "text-text-light-gray hover:text-white-black"
          }`}
        >
          <Layers size={16} strokeWidth={1.5} />
          <span className="hidden @md:inline">
            {`Group: ${groupBy === "time" ? "Due date" : "Board"}`}
          </span>
        </button>
        )}
        {groupOpen && (
          <MyTasksGroupPicker groupBy={groupBy} onChange={(next) => onChange({ ...config, groupBy: next })} onClose={() => setGroupOpen(false)} />
        )}
      </div>
    </div>
  );
};

export default MyTasksViewControls;
