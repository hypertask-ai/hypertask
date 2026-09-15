"use client";

import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import { useFlag } from "@/hooks/useFlag";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { EstimateConstants, PriorityConstants } from "@/lib/constants/constants";
import {
  MY_TASKS_FILTER_PARITY_FLAG,
  MY_TASKS_SCOPES_FLAG,
  MY_TASKS_TABLE_COLUMNS_FLAG,
  MY_TASKS_TIME_GROUP_FLAG,
  MY_TASKS_VIEWS_FLAG,
} from "@/lib/flags/keys";
import {
  MY_TASKS_SCOPE_VALUES,
  normalizeMyTasksScopes,
  type MyTasksScope,
} from "@/lib/myTasksScopes";
import { migrateFlatFiltersToFilterSettings, myTasksParityFilterCount } from "@/lib/filterSettingsMutations";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  effectiveMyTasksGroupBy,
  type MyTasksBoardMetadata,
  type MyTasksDateRange,
  type MyTasksDueDatePreset,
  type MyTasksGroupBy,
  type MyTasksViewConfig,
} from "@/models/MyTasksView";
import { ArrowUpDown, Columns3, Layers, LayoutGrid, SlidersHorizontal, UserRound } from "lucide-react";
import { useMemo, useRef, useState } from "react";

interface Props {
  boards: MyTasksBoardMetadata[];
  config: MyTasksViewConfig;
  onChange: (config: MyTasksViewConfig) => void;
  onOpenKanbanFilters?: () => void;
  timeGroupEnabled?: boolean;
  tableColumnsEnabled?: boolean;
  onOpenTableColumns?: () => void;
}

const INVOLVEMENT_OPTIONS: Array<{ value: MyTasksScope; label: string }> = [
  { value: "assigned", label: "Assigned to me" },
  { value: "created", label: "Created by me" },
  { value: "mentioned", label: "Mentioned" },
  { value: "watching", label: "Watching" },
];

const DUE_DATE_OPTIONS: Array<{ value: MyTasksDueDatePreset; label: string }> = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "next_7_days", label: "Next 7 days" },
  { value: "no_due_date", label: "No due date" },
];

const SORT_FIELDS: Array<{ value: MyTasksViewConfig["sort"]["field"]; label: string }> = [
  { value: "dueDate", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
  { value: "title", label: "Title" },
  { value: "board", label: "Board" },
];

const localDateInputValue = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section className="space-y-1.5">
    <p className="text-meta font-semibold text-text-light-gray">{label}</p>
    {children}
  </section>
);

const CheckRow = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) => (
  <label className="flex cursor-pointer items-center gap-2 rounded-[4px] px-1 py-1 text-content text-white-black hover:bg-hover-active">
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="size-3.5 accent-shadcn-primary"
    />
    <span className="min-w-0 truncate">{label}</span>
  </label>
);

const inputClass =
  "h-8 rounded-[4px] border-0 bg-transparent px-2 text-content text-white-black outline-none focus:bg-active-modal-element";

const MyTasksViewControls = ({
  boards,
  config,
  onChange,
  onOpenKanbanFilters,
  timeGroupEnabled = false,
  tableColumnsEnabled = false,
  onOpenTableColumns,
}: Props) => {
  const myTasksViewsEnabled = useFlag(MY_TASKS_VIEWS_FLAG);
  const filterParityEnabled = useFlag(MY_TASKS_FILTER_PARITY_FLAG);
  const myTasksTimeGroupEnabled = useFlag(MY_TASKS_TIME_GROUP_FLAG);
  const myTasksTableColumnsFlag = useFlag(MY_TASKS_TABLE_COLUMNS_FLAG);
  const myTasksScopesEnabled = useFlag(MY_TASKS_SCOPES_FLAG);
  const [filterOpen, setFilterOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [involvementOpen, setInvolvementOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const involvementRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  useClickOutside(filterRef, () => setFilterOpen(false));
  useClickOutside(scopeRef, () => setScopeOpen(false));
  useClickOutside(involvementRef, () => setInvolvementOpen(false));
  useClickOutside(sortRef, () => setSortOpen(false));
  useClickOutside(groupRef, () => setGroupOpen(false));

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

  const groupBy = effectiveMyTasksGroupBy(
    config,
    Boolean(myTasksTimeGroupEnabled && timeGroupEnabled),
  );

  const selectedBoardIds = config.boardIds ?? boards.map((board) => board.id);
  const selectedBoards = useMemo(
    () => boards.filter((board) => selectedBoardIds.includes(board.id)),
    [boards, selectedBoardIds],
  );
  const flatFilterCount = [
    config.boardIds,
    config.filters.priorityIds.length ? config.filters.priorityIds : null,
    config.filters.labelIds.length ? config.filters.labelIds : null,
    config.filters.sizeIds.length ? config.filters.sizeIds : null,
    config.filters.sectionIds.length ? config.filters.sectionIds : null,
    config.filters.starred,
    config.filters.dueDate,
    config.filters.createdRange,
    config.filters.updatedRange,
    config.filters.showDone ? true : null,
  ].filter((value) => value !== null).length;

  const kanbanFilterCount = myTasksParityFilterCount(config);
  const scopeCount = [
    config.boardIds,
    config.filters.sectionIds.length ? config.filters.sectionIds : null,
    config.filters.showDone ? true : null,
  ].filter((value) => value !== null).length;

  const updateFilters = (filters: Partial<MyTasksViewConfig["filters"]>) =>
    onChange({ ...config, filters: { ...config.filters, ...filters } });

  const toggleNumber = (
    key: "priorityIds" | "sizeIds" | "sectionIds",
    value: number,
  ) => {
    const current = config.filters[key];
    updateFilters({
      [key]: current.includes(value)
        ? current.filter((id) => id !== value)
        : [...current, value],
    });
  };

  const toggleLabel = (value: string) => {
    const current = config.filters.labelIds;
    updateFilters({
      labelIds: current.some((id) => String(id) === value)
        ? current.filter((id) => String(id) !== value)
        : [...current, value],
    });
  };

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

  const setRange = (
    key: "createdRange" | "updatedRange",
    side: keyof MyTasksDateRange,
    value: string,
  ) => {
    if (!value) {
      updateFilters({ [key]: null });
      return;
    }
    const current = config.filters[key] ?? { from: value, to: value };
    updateFilters({ [key]: { ...current, [side]: value } });
  };

  const dueDateValue =
    typeof config.filters.dueDate === "object" && config.filters.dueDate
      ? "custom"
      : (config.filters.dueDate ?? "");

  const scopePanel = (
    <div className="absolute right-0 top-full z-40 mt-1 max-h-[min(72vh,620px)] w-[min(92vw,420px)] overflow-y-auto rounded-[5px] bg-modalBackground p-4 shadow-md">
      <div className="grid gap-5">
        <Field label="Boards">
          <CheckRow
            checked={config.boardIds === null}
            label="All boards"
            onChange={() => setBoards(null)}
          />
          <div className="max-h-36 overflow-y-auto">
            {boards.map((board) => (
              <CheckRow
                key={board.id}
                checked={selectedBoardIds.includes(board.id)}
                label={board.title}
                onChange={() => toggleBoard(board.id)}
              />
            ))}
          </div>
        </Field>

        <Field label="Columns">
          <div className="max-h-44 overflow-y-auto">
            {selectedBoards.map((board) => (
              <div key={board.id} className="mb-2">
                <p className="px-1 text-micro text-text-light-gray">{board.title}</p>
                {board.sections.map((section) => (
                  <CheckRow
                    key={section.id}
                    checked={config.filters.sectionIds.includes(section.id)}
                    label={section.title}
                    onChange={() => toggleNumber("sectionIds", section.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </Field>

        <Field label="Completed tasks">
          <CheckRow
            checked={config.filters.showDone}
            label="Show done"
            onChange={() => updateFilters({ showDone: !config.filters.showDone })}
          />
        </Field>
      </div>
    </div>
  );

  if (!myTasksViewsEnabled) return null;

  const closeOtherMenus = () => {
    setScopeOpen(false);
    setInvolvementOpen(false);
    setSortOpen(false);
    setGroupOpen(false);
    setFilterOpen(false);
  };

  return (
    <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto">
      {myTasksScopesEnabled ? (
        <div ref={involvementRef} className="relative">
          <button
            type="button"
            aria-label="My Tasks involvement"
            aria-expanded={involvementOpen}
            onClick={() => {
              setInvolvementOpen((open) => !open);
              setScopeOpen(false);
              setSortOpen(false);
              setGroupOpen(false);
              setFilterOpen(false);
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
          {involvementOpen && (
            <div className="absolute right-0 top-full z-40 mt-1 w-56 space-y-1 rounded-[5px] bg-modalBackground p-2 shadow-md">
              <Field label="Show tasks">
                {INVOLVEMENT_OPTIONS.map((option) => (
                  <CheckRow
                    key={option.value}
                    checked={scopes.includes(option.value)}
                    label={option.label}
                    onChange={() => toggleScope(option.value)}
                  />
                ))}
              </Field>
            </div>
          )}
        </div>
      ) : null}
      {myTasksTableColumnsFlag && tableColumnsEnabled && onOpenTableColumns ? (
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
      ) : null}
      {filterParityEnabled ? (
        <>
          <div ref={scopeRef} className="relative">
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
            {scopeOpen && scopePanel}
          </div>

          <button
            type="button"
            aria-label="Filter My Tasks"
            onClick={() => {
              setScopeOpen(false);
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
        </>
      ) : (
        <div ref={filterRef} className="relative">
          <button
            type="button"
            aria-label="Filter My Tasks"
            aria-expanded={filterOpen}
            onClick={() => {
              setFilterOpen((open) => !open);
              setSortOpen(false);
              setGroupOpen(false);
            }}
            className={`${MOBILE_TARGET} h-8 gap-1.5 rounded-[4px] px-2 text-content transition-colors hover:bg-hover-active @md:min-h-0 @md:min-w-0 ${
              flatFilterCount > 0
                ? "text-shadcn-primary"
                : "text-text-light-gray hover:text-white-black"
            }`}
          >
            <SlidersHorizontal size={16} strokeWidth={1.5} />
            <span className="hidden @md:inline">Filters</span>
            {flatFilterCount > 0 && (
              <span className="text-meta font-semibold">{flatFilterCount}</span>
            )}
          </button>

          {filterOpen && (
            <div className="absolute right-0 top-full z-40 mt-1 max-h-[min(72vh,620px)] w-[min(92vw,560px)] overflow-y-auto rounded-[5px] bg-modalBackground p-4 shadow-md">
              <div className="grid gap-5 @md:grid-cols-2">
                <Field label="Boards">
                  <CheckRow
                    checked={config.boardIds === null}
                    label="All boards"
                    onChange={() => setBoards(null)}
                  />
                  <div className="max-h-36 overflow-y-auto">
                    {boards.map((board) => (
                      <CheckRow
                        key={board.id}
                        checked={selectedBoardIds.includes(board.id)}
                        label={board.title}
                        onChange={() => toggleBoard(board.id)}
                      />
                    ))}
                  </div>
                </Field>

                <Field label="Columns">
                  <div className="max-h-44 overflow-y-auto">
                    {selectedBoards.map((board) => (
                      <div key={board.id} className="mb-2">
                        <p className="px-1 text-micro text-text-light-gray">
                          {board.title}
                        </p>
                        {board.sections.map((section) => (
                          <CheckRow
                            key={section.id}
                            checked={config.filters.sectionIds.includes(section.id)}
                            label={section.title}
                            onChange={() => toggleNumber("sectionIds", section.id)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </Field>

                <Field label="Priority">
                  <div className="grid grid-cols-2 gap-x-2">
                    {PriorityConstants.map((priority) => (
                      <CheckRow
                        key={priority.priority_index}
                        checked={config.filters.priorityIds.includes(
                          priority.priority_index,
                        )}
                        label={priority.Priority_Value}
                        onChange={() =>
                          toggleNumber("priorityIds", priority.priority_index)
                        }
                      />
                    ))}
                  </div>
                </Field>

                <Field label="Size">
                  <div className="grid grid-cols-2 gap-x-2">
                    {EstimateConstants.map((estimate) => (
                      <CheckRow
                        key={estimate.estimate_index}
                        checked={config.filters.sizeIds.includes(
                          estimate.estimate_index,
                        )}
                        label={estimate.estimate_value}
                        onChange={() =>
                          toggleNumber("sizeIds", estimate.estimate_index)
                        }
                      />
                    ))}
                  </div>
                </Field>

                <Field label="Labels">
                  <div className="max-h-44 overflow-y-auto">
                    {selectedBoards.map((board) => (
                      <div key={board.id} className="mb-2">
                        <p className="px-1 text-micro text-text-light-gray">
                          {board.title}
                        </p>
                        {board.labels.map((label) => (
                          <CheckRow
                            key={label.id}
                            checked={config.filters.labelIds.some(
                              (id) => String(id) === label.id,
                            )}
                            label={label.name}
                            onChange={() => toggleLabel(label.id)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </Field>

                <Field label="Due date">
                  <select
                    value={dueDateValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "custom") {
                        const today = localDateInputValue(new Date());
                        updateFilters({ dueDate: { from: today, to: today } });
                        return;
                      }
                      updateFilters({
                        dueDate: value
                          ? (value as MyTasksDueDatePreset)
                          : null,
                      });
                    }}
                    className={`${inputClass} w-full`}
                  >
                    <option value="">Any</option>
                    {DUE_DATE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    <option value="custom">Custom range</option>
                  </select>
                  {typeof config.filters.dueDate === "object" &&
                    config.filters.dueDate && (
                      <div className="mt-2 flex gap-2">
                        <input
                          type="date"
                          aria-label="Due date from"
                          value={config.filters.dueDate.from.slice(0, 10)}
                          onChange={(event) =>
                            updateFilters({
                              dueDate: {
                                ...(config.filters.dueDate as MyTasksDateRange),
                                from: event.target.value,
                              },
                            })
                          }
                          className={inputClass}
                        />
                        <input
                          type="date"
                          aria-label="Due date to"
                          value={config.filters.dueDate.to.slice(0, 10)}
                          onChange={(event) =>
                            updateFilters({
                              dueDate: {
                                ...(config.filters.dueDate as MyTasksDateRange),
                                to: event.target.value,
                              },
                            })
                          }
                          className={inputClass}
                        />
                      </div>
                    )}
                </Field>

                <Field label="Created">
                  <div className="flex gap-2">
                    <input
                      type="date"
                      aria-label="Created from"
                      value={config.filters.createdRange?.from.slice(0, 10) ?? ""}
                      onChange={(event) =>
                        setRange("createdRange", "from", event.target.value)
                      }
                      className={inputClass}
                    />
                    <input
                      type="date"
                      aria-label="Created to"
                      value={config.filters.createdRange?.to.slice(0, 10) ?? ""}
                      onChange={(event) =>
                        setRange("createdRange", "to", event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                </Field>

                <Field label="Updated">
                  <div className="flex gap-2">
                    <input
                      type="date"
                      aria-label="Updated from"
                      value={config.filters.updatedRange?.from.slice(0, 10) ?? ""}
                      onChange={(event) =>
                        setRange("updatedRange", "from", event.target.value)
                      }
                      className={inputClass}
                    />
                    <input
                      type="date"
                      aria-label="Updated to"
                      value={config.filters.updatedRange?.to.slice(0, 10) ?? ""}
                      onChange={(event) =>
                        setRange("updatedRange", "to", event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                </Field>

                <Field label="Starred">
                  <select
                    value={
                      config.filters.starred === null
                        ? "any"
                        : String(config.filters.starred)
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      updateFilters({
                        starred:
                          value === "any" ? null : value === "true",
                      });
                    }}
                    className={`${inputClass} w-full`}
                  >
                    <option value="any">Any</option>
                    <option value="true">Starred</option>
                    <option value="false">Not starred</option>
                  </select>
                </Field>

                <Field label="Completed tasks">
                  <CheckRow
                    checked={config.filters.showDone}
                    label="Show done"
                    onChange={() =>
                      updateFilters({ showDone: !config.filters.showDone })
                    }
                  />
                </Field>
              </div>

              <div className="mt-4 flex justify-end border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() =>
                    updateFilters(DEFAULT_MY_TASKS_VIEW_CONFIG.filters)
                  }
                  className="rounded-[4px] px-2 py-1 text-content text-text-light-gray hover:bg-hover-active hover:text-white-black"
                >
                  Clear filters
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div ref={sortRef} className="relative">
        <button
          type="button"
          aria-label="Sort My Tasks"
          aria-expanded={sortOpen}
            onClick={() => {
              setSortOpen((open) => !open);
              setFilterOpen(false);
              setScopeOpen(false);
              setInvolvementOpen(false);
              setGroupOpen(false);
            }}
          className={`${MOBILE_TARGET} h-8 gap-1.5 rounded-[4px] px-2 text-content text-text-light-gray transition-colors hover:bg-hover-active hover:text-white-black @md:min-h-0 @md:min-w-0`}
        >
          <ArrowUpDown size={16} strokeWidth={1.5} />
          <span className="hidden @md:inline">Sort</span>
        </button>
        {sortOpen && (
          <div className="absolute right-0 top-full z-40 mt-1 w-56 space-y-3 rounded-[5px] bg-modalBackground p-3 shadow-md">
            <Field label="Field">
              <select
                value={config.sort.field}
                onChange={(event) =>
                  onChange({
                    ...config,
                    sort: {
                      ...config.sort,
                      field: event.target
                        .value as MyTasksViewConfig["sort"]["field"],
                    },
                  })
                }
                className={`${inputClass} w-full`}
              >
                {SORT_FIELDS.map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Direction">
              <select
                value={config.sort.direction}
                onChange={(event) =>
                  onChange({
                    ...config,
                    sort: {
                      ...config.sort,
                      direction: event.target.value as "asc" | "desc",
                    },
                  })
                }
                className={`${inputClass} w-full`}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </Field>
          </div>
        )}
      </div>

      {myTasksTimeGroupEnabled && timeGroupEnabled && (
        <div ref={groupRef} className="relative">
          <button
            type="button"
            aria-label="Group My Tasks"
            aria-expanded={groupOpen}
            onClick={() => {
              setGroupOpen((open) => !open);
              setFilterOpen(false);
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
              {groupBy === "time" ? "Time" : "Board"}
            </span>
          </button>
          {groupOpen && (
            <div className="absolute right-0 top-full z-40 mt-1 w-44 space-y-1 rounded-[5px] bg-modalBackground p-2 shadow-md">
              {(
                [
                  { value: "time", label: "Time" },
                  { value: "board", label: "Board" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    const next: MyTasksGroupBy = option.value;
                    onChange({ ...config, groupBy: next });
                    setGroupOpen(false);
                  }}
                  className={`flex w-full items-center rounded-[4px] px-2 py-1.5 text-left text-content hover:bg-hover-active ${
                    groupBy === option.value
                      ? "text-shadcn-primary"
                      : "text-white-black"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MyTasksViewControls;
