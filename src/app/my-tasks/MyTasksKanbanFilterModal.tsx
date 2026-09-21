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

type Props = {
  settings: SerializableFilterSettings | null | undefined;
  onChange: (next: SerializableFilterSettings) => void;
  onClearAll: () => void;
  notStarred: boolean;
  onClearNotStarred: () => void;
  members: CalendarUserSummary[];
  labels: CalendarLabelSummary[];
  onClose: () => void;
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
}: Props) {
  const filterParityEnabled = useFlag(MY_TASKS_FILTER_PARITY_FLAG);
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
        toggle={onClose}
        filteredMembers={members}
        allTags={labels}
      />
    </MyTasksFilterProvider>
  );
}
