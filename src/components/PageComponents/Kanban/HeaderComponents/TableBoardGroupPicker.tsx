"use client";

import OptionPickerModal from "@/components/Modals/OptionPicker";
import type { TableGroupBy } from "@/components/PageComponents/Kanban/TableView/tableGroupByTag";

export default function TableBoardGroupPicker({
  groupBy,
  onChange,
  onClose,
}: {
  groupBy: TableGroupBy;
  onChange: (groupBy: TableGroupBy) => void;
  onClose: () => void;
}) {
  return (
    <OptionPickerModal
      header="Group by"
      options={[
        { id: "column", label: "Column", hint: "Board columns", checked: groupBy === "column" },
        { id: "tag", label: "Tag", hint: "One group per label", checked: groupBy === "tag" },
      ]}
      onSelect={(option) => {
        if (option.id !== "column" && option.id !== "tag") return;
        onChange(option.id);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
