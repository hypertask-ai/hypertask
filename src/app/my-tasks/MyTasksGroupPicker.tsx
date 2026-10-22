"use client";

import OptionPickerModal from "@/components/Modals/OptionPicker";
import type { MyTasksGroupBy } from "@/models/MyTasksView";

export default function MyTasksGroupPicker({ groupBy, onChange, onClose }: {
  groupBy: MyTasksGroupBy;
  onChange: (groupBy: MyTasksGroupBy) => void;
  onClose: () => void;
}) {
  return (
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
  );
}
