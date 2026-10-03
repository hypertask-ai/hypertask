"use client";

import AllFilterHTC from "@/components/Modals/FilterModals/SelectFilters/FilterHTC";
import { useFlag } from "@/hooks/useFlag";
import type {
  CalendarLabelSummary,
  CalendarUserSummary,
} from "@/lib/calendarSync/contract";
import type { SerializableFilterSettings } from "@/lib/filterSettingsMutations";
import { HTPR_6567_COMMAND_SCOPE_PICKER_FLAG, MY_TASKS_FILTER_PARITY_FLAG, MY_TASKS_SNOOZE_FLAG } from "@/lib/flags/keys";
import type { MyTasksBoardMetadata, MyTasksViewConfig } from "@/models/MyTasksView";
import { MyTasksFilterProvider } from "@/lib/myTasksFilterContext";
import { CheckRow, Field } from "./MyTasksViewControls";

type Props = {
  settings: SerializableFilterSettings | null | undefined;
  onChange: (next: SerializableFilterSettings) => void;
  onClearAll: () => void;
  notStarred: boolean;
  onClearNotStarred: () => void;
  members: CalendarUserSummary[];
  labels: CalendarLabelSummary[];
  onClose: () => void;
  boards?: MyTasksBoardMetadata[];
  config?: MyTasksViewConfig;
  onViewChange?: (next: MyTasksViewConfig) => void;
  snoozeEnabled?: boolean;
};

/** Board-agnostic FilterHTC host for My Tasks (static import keeps feature-flag-gate coverage). */
export default function MyTasksKanbanFilterModal({
  settings,
  onChange,
  onClearAll,
  notStarred,
  onClearNotStarred,
  members,
  labels,
  onClose,
  boards = [],
  config,
  onViewChange,
  snoozeEnabled = false,
}: Props) {
  const filterParityEnabled = useFlag(MY_TASKS_FILTER_PARITY_FLAG);
  const commandScopePickerEnabled = useFlag(HTPR_6567_COMMAND_SCOPE_PICKER_FLAG);
  const snoozeFlag = useFlag(MY_TASKS_SNOOZE_FLAG);
  const updateScopeFilters = (filters: Partial<MyTasksViewConfig["filters"]>) => {
    if (config && onViewChange) onViewChange({ ...config, filters: { ...config.filters, ...filters } });
  };
  const scopeFilters = commandScopePickerEnabled && config && onViewChange ? (
    <div className="px-4 py-2 space-y-4">
      <Field label="Columns">
        {boards.filter((board) => config.boardIds === null || config.boardIds.includes(board.id)).map((board) => (
          <div key={board.id} className="mb-2">
            <p className="px-1 text-micro text-text-light-gray">{board.title}</p>
            {board.sections.map((section) => (
              <CheckRow key={section.id} label={section.title} checked={config.filters.sectionIds.includes(section.id)}
                onChange={() => updateScopeFilters({ sectionIds: config.filters.sectionIds.includes(section.id)
                  ? config.filters.sectionIds.filter((id) => id !== section.id) : [...config.filters.sectionIds, section.id] })}
              />
            ))}
          </div>
        ))}
      </Field>
      <Field label="Completed tasks">
        <CheckRow label="Show done" checked={config.filters.showDone}
          onChange={() => updateScopeFilters({ showDone: !config.filters.showDone })} />
      </Field>
      {snoozeFlag && snoozeEnabled ? (
        <Field label="Snoozed tasks">
          <CheckRow label="Show snoozed" checked={config.filters.showSnoozed === true}
            onChange={() => updateScopeFilters({ showSnoozed: !config.filters.showSnoozed })} />
        </Field>
      ) : null}
    </div>
  ) : null;
  if (!filterParityEnabled) return null;

  return (
    <MyTasksFilterProvider
      settings={settings}
      onChange={onChange}
      onClearAll={onClearAll}
      members={members}
      labels={labels}
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
        extraFilters={scopeFilters}
        toggle={onClose}
        filteredMembers={members}
        allTags={labels}
      />
    </MyTasksFilterProvider>
  );
}
