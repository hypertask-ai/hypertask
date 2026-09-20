"use client";

import AllFilterHTC from "@/components/Modals/FilterModals/SelectFilters/FilterHTC";
import { useFlag } from "@/hooks/useFlag";
import type {
  CalendarLabelSummary,
  CalendarUserSummary,
} from "@/lib/calendarSync/contract";
import type { SerializableFilterSettings } from "@/lib/filterSettingsMutations";
import { MY_TASKS_FILTER_PARITY_FLAG } from "@/lib/flags/keys";
import { MyTasksFilterProvider } from "@/lib/myTasksFilterContext";
import type { MyTasksScope } from "@/lib/myTasksScopes";
import { ModalHeaderComp } from "@/components/Common/CommonModalComponents";
import type {
  MyTasksBoardMetadata,
  MyTasksViewConfig,
} from "@/models/MyTasksView";
import { Check } from "lucide-react";
import { ModalBody } from "reactstrap";

type Props = {
  settings: SerializableFilterSettings | null | undefined;
  onChange: (next: SerializableFilterSettings) => void;
  onClearAll: () => void;
  notStarred: boolean;
  onClearNotStarred: () => void;
  members: CalendarUserSummary[];
  labels: CalendarLabelSummary[];
  scopes: MyTasksScope[];
  involvementEnabled: boolean;
  onScopesChange: (scopes: MyTasksScope[]) => void;
  boards: MyTasksBoardMetadata[];
  config: MyTasksViewConfig;
  onConfigChange: (config: MyTasksViewConfig) => void;
  snoozeEnabled: boolean;
  showScopeFilters: boolean;
  onClose: () => void;
};

const ScopeCheckRow = ({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    aria-pressed={checked}
    onClick={onClick}
    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[4px] px-2 text-left text-content text-white-black hover:bg-hover-active"
  >
    <span className="truncate">{label}</span>
    {checked ? <Check size={16} strokeWidth={1.75} /> : null}
  </button>
);

/** Board-agnostic FilterHTC host for My Tasks (static import keeps feature-flag-gate coverage). */
export default function MyTasksKanbanFilterModal({
  settings,
  onChange,
  onClearAll,
  notStarred,
  onClearNotStarred,
  members,
  labels,
  scopes,
  involvementEnabled,
  onScopesChange,
  boards,
  config,
  onConfigChange,
  snoozeEnabled,
  showScopeFilters,
  onClose,
}: Props) {
  const filterParityEnabled = useFlag(MY_TASKS_FILTER_PARITY_FLAG);
  if (!filterParityEnabled) return null;

  const selectedBoardIds = config.boardIds ?? boards.map((board) => board.id);
  const selectedBoards = boards.filter((board) => selectedBoardIds.includes(board.id));
  const updateFilters = (filters: Partial<MyTasksViewConfig["filters"]>) =>
    onConfigChange({ ...config, filters: { ...config.filters, ...filters } });
  const setBoards = (boardIds: number[] | null) => {
    const effectiveIds = boardIds ?? boards.map((board) => board.id);
    const availableBoards = boards.filter((board) => effectiveIds.includes(board.id));
    const allowedSections = new Set(
      availableBoards.flatMap((board) => board.sections.map((section) => section.id)),
    );
    onConfigChange({
      ...config,
      boardIds,
      filters: {
        ...config.filters,
        sectionIds: config.filters.sectionIds.filter((id) => allowedSections.has(id)),
      },
    });
  };
  const toggleBoard = (boardId: number) => {
    const next = selectedBoardIds.includes(boardId)
      ? selectedBoardIds.filter((id) => id !== boardId)
      : [...selectedBoardIds, boardId];
    setBoards(next.length === boards.length ? null : next);
  };
  const toggleSection = (sectionId: number) => {
    const selected = config.filters.sectionIds;
    updateFilters({
      sectionIds: selected.includes(sectionId)
        ? selected.filter((id) => id !== sectionId)
        : [...selected, sectionId],
    });
  };
  const scopeFilterCount = [
    config.boardIds,
    config.filters.sectionIds.length ? config.filters.sectionIds : null,
    config.filters.showDone ? true : null,
    snoozeEnabled && config.filters.showSnoozed ? true : null,
  ].filter((value) => value !== null).length;
  const scopePanel = showScopeFilters ? (
    <>
      <ModalHeaderComp header="Boards, columns, and status" />
      <ModalBody className="max-h-[364px] overflow-y-auto rounded-b-[4px] p-2">
        <section className="mb-3">
          <p className="px-2 py-1 text-meta font-semibold text-text-light-gray">Boards</p>
          <ScopeCheckRow
            checked={config.boardIds === null}
            label="All boards"
            onClick={() => setBoards(null)}
          />
          {boards.map((board) => (
            <ScopeCheckRow
              key={board.id}
              checked={selectedBoardIds.includes(board.id)}
              label={board.title}
              onClick={() => toggleBoard(board.id)}
            />
          ))}
        </section>
        <section className="mb-3">
          <p className="px-2 py-1 text-meta font-semibold text-text-light-gray">Columns</p>
          {selectedBoards.map((board) => (
            <div key={board.id} className="mb-2">
              <p className="px-2 py-1 text-micro text-text-light-gray">{board.title}</p>
              {board.sections.map((section) => (
                <ScopeCheckRow
                  key={section.id}
                  checked={config.filters.sectionIds.includes(section.id)}
                  label={section.title}
                  onClick={() => toggleSection(section.id)}
                />
              ))}
            </div>
          ))}
        </section>
        <section>
          <p className="px-2 py-1 text-meta font-semibold text-text-light-gray">Status</p>
          <ScopeCheckRow
            checked={config.filters.showDone}
            label="Show completed tasks"
            onClick={() => updateFilters({ showDone: !config.filters.showDone })}
          />
          {snoozeEnabled ? (
            <ScopeCheckRow
              checked={config.filters.showSnoozed === true}
              label="Show snoozed tasks"
              onClick={() =>
                updateFilters({ showSnoozed: !config.filters.showSnoozed })
              }
            />
          ) : null}
        </section>
      </ModalBody>
    </>
  ) : undefined;

  return (
    <MyTasksFilterProvider
      settings={settings}
      onChange={onChange}
      onClearAll={onClearAll}
      members={members}
      labels={labels}
      scopes={scopes}
      involvementEnabled={involvementEnabled}
      scopePanel={scopePanel}
      scopeFilterCount={scopeFilterCount}
      onScopesChange={onScopesChange}
    >
      {notStarred ? (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-[5px] border border-border-light bg-modalBackground px-3 py-2 text-content text-white-black shadow-md">
            <span>Not starred is on.</span>
            <button
              type="button"
              className="shrink-0 text-shadcn-primary underline"
              onClick={onClearNotStarred}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
      <AllFilterHTC
        view="MyTasks"
        toggle={onClose}
        filteredMembers={members}
        allTags={labels}
      />
    </MyTasksFilterProvider>
  );
}
