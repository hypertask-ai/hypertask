"use client";

import AllFilterHTC from "@/components/Modals/FilterModals/SelectFilters/FilterHTC";
import type {
  CalendarLabelSummary,
  CalendarUserSummary,
} from "@/lib/calendarSync/contract";
import type { SerializableFilterSettings } from "@/lib/filterSettingsMutations";
import { MyTasksFilterProvider } from "@/lib/myTasksFilterContext";

type Props = {
  settings: SerializableFilterSettings | null | undefined;
  onChange: (next: SerializableFilterSettings) => void;
  members: CalendarUserSummary[];
  labels: CalendarLabelSummary[];
  onClose: () => void;
};

/** Isolated so MyTasks.tsx can load FilterHTC only when the modal opens (jiti-safe). */
export default function MyTasksKanbanFilterModal({
  settings,
  onChange,
  members,
  labels,
  onClose,
}: Props) {
  return (
    <MyTasksFilterProvider
      settings={settings}
      onChange={onChange}
      members={members}
      labels={labels}
    >
      <AllFilterHTC
        view="MyTasks"
        toggle={onClose}
        filteredMembers={members}
        allTags={labels}
      />
    </MyTasksFilterProvider>
  );
}
