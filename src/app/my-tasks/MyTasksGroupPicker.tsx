"use client";

import OptionPickerModal from "@/components/Modals/OptionPicker";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG } from "@/lib/flags/keys";
import type { MyTasksGroupBy } from "@/models/MyTasksView";

export default function MyTasksGroupPicker({ groupBy, onChange, onClose }: {
  groupBy: MyTasksGroupBy;
  onChange: (groupBy: MyTasksGroupBy) => void;
  onClose: () => void;
}) {
  const kanbanReuseEnabled = useFlag(HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG);
  return kanbanReuseEnabled ? (
    <OptionPickerModal
      header="Group by"
      options={[
        { id: "time", label: "Due date", hint: "Overdue, Later, No due date", checked: groupBy === "time" },
        { id: "board", label: "Board", checked: groupBy === "board" },
      ]}
      onSelect={(option) => {
        if (option.id !== "time" && option.id !== "board") return;
        onChange(option.id);
        onClose();
      }}
      onClose={onClose}
    />
  ) : null;
}
