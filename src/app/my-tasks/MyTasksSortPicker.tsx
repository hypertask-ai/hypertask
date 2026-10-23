"use client";

import BoardPriorityMode, { type PickerSortingLevel } from "@/components/Modals/Kanban/BoardPriorityMode";
import type { MyTasksViewConfig } from "@/models/MyTasksView";
import type { SortingMode } from "@prisma/client";

const modes: Record<Exclude<MyTasksViewConfig["sort"]["field"], "board">, SortingMode> = {
  dueDate: "DueDate",
  priority: "Priority",
  createdAt: "CreatedAt",
  updatedAt: "UpdatedAt",
  title: "Title",
};
const availableModes = Object.values(modes);
const extraModes = [{ id: "board" as const, label: "Board" }];

export default function MyTasksSortPicker({ sort, onSortChange, onClose }: {
  sort: MyTasksViewConfig["sort"];
  onSortChange: (sort: MyTasksViewConfig["sort"]) => void;
  onClose: () => void;
}) {
  const level: PickerSortingLevel<"board"> = {
    mode: sort.field === "board" ? "board" : modes[sort.field],
    order: sort.direction === "asc" ? "Ascending" : "Descending",
  };
  return (
    <BoardPriorityMode
      sort={level}
      onSortChange={(next) => {
        if (!next) return;
        const field = next.mode === "board" ? "board" :
          (Object.keys(modes) as Array<keyof typeof modes>).find((key) => modes[key] === next.mode);
        if (field) onSortChange({ field, direction: next.order === "Ascending" ? "asc" : "desc" });
      }}
      modes={availableModes}
      extraModes={extraModes}
      allowClear={false}
      maxLevels={1}
      closeHandler={onClose}
    />
  );
}
