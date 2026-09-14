import React from "react";
import { Archive, Columns3, Tag, UserRoundPlus } from "lucide-react";

import Tooltip from "@/components/Common/Tooltip";
import { useFlag } from "@/hooks/useFlag";
import { CommandMode } from "@/models/enums";
import { HTPR_6444_TABLE_BULK_SELECT_FLAG } from "@/lib/flags/keys";
import { useKanbanBulkSelection } from "@/lib/contexts/Kanban/BulkSelectionContext";

interface KanbanBulkActionBarProps {
  tableActionsEnabled?: boolean;
}

const KanbanBulkActionBar = ({
  tableActionsEnabled = false,
}: KanbanBulkActionBarProps) => {
  const tableBulkSelectFlag = useFlag(HTPR_6444_TABLE_BULK_SELECT_FLAG);
  const {
    selectedCount,
    failedIds,
    isProcessing,
    archiveSelected,
    openBulkCommand,
  } = useKanbanBulkSelection();
  const showTableActions = tableBulkSelectFlag && tableActionsEnabled;

  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-[5px] bg-modalBackground px-3 py-2 text-content text-white-black customshadow-4"
      role="status"
      aria-live="polite"
    >
      <span>
        {selectedCount} selected
        {failedIds.size > 0 ? ` · ${failedIds.size} failed` : ""}
      </span>
      {showTableActions && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Archive ${selectedCount} selected tasks`}
            className="group relative rounded-[4px] p-1 text-text-light-gray hover:bg-hover-active hover:text-white-black disabled:cursor-wait disabled:opacity-60"
            onClick={() => void archiveSelected()}
            disabled={isProcessing}
          >
            <Archive size={17} strokeWidth={1.75} />
            <Tooltip
              text={`Archive ${selectedCount} selected tasks`}
              left={-40}
              bottom={-36}
              keyCombination={["CMD/CTRL", "E"]}
            />
          </button>
          <button
            type="button"
            aria-label={`Assign ${selectedCount} selected tasks`}
            className="group relative rounded-[4px] p-1 text-text-light-gray hover:bg-hover-active hover:text-white-black disabled:cursor-wait disabled:opacity-60"
            onClick={() => openBulkCommand(CommandMode.OpenAssignModal)}
            disabled={isProcessing}
          >
            <UserRoundPlus size={17} strokeWidth={1.75} />
            <Tooltip
              text={`Assign ${selectedCount} selected tasks`}
              left={-40}
              bottom={-36}
              keyCombination={["A"]}
            />
          </button>
          <button
            type="button"
            aria-label={`Label ${selectedCount} selected tasks`}
            className="group relative rounded-[4px] p-1 text-text-light-gray hover:bg-hover-active hover:text-white-black disabled:cursor-wait disabled:opacity-60"
            onClick={() => openBulkCommand(CommandMode.LabelModal)}
            disabled={isProcessing}
          >
            <Tag size={17} strokeWidth={1.75} />
            <Tooltip
              text={`Label ${selectedCount} selected tasks`}
              left={-40}
              bottom={-36}
              keyCombination={["T"]}
            />
          </button>
          <button
            type="button"
            aria-label={`Move ${selectedCount} selected tasks to column`}
            className="group relative rounded-[4px] p-1 text-text-light-gray hover:bg-hover-active hover:text-white-black disabled:cursor-wait disabled:opacity-60"
            onClick={() => openBulkCommand(CommandMode.MoveToColumn)}
            disabled={isProcessing}
          >
            <Columns3 size={17} strokeWidth={1.75} />
            <Tooltip
              text={`Move ${selectedCount} selected tasks to column`}
              left={-40}
              bottom={-36}
              keyCombination={["M"]}
            />
          </button>
        </div>
      )}
      <button
        type="button"
        className="rounded-[4px] bg-hypertasks-purple px-3 py-1.5 text-content text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        onClick={() => openBulkCommand()}
        disabled={isProcessing}
      >
        Open actions
      </button>
      <span className="text-meta text-text-light-gray">Esc to clear</span>
    </div>
  );
};

export default KanbanBulkActionBar;
