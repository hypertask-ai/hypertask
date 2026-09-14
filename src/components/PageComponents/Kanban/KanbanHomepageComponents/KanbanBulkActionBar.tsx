import React from "react";
import { Archive } from "lucide-react";

import Tooltip from "@/components/Common/Tooltip";
import { useFlag } from "@/hooks/useFlag";
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
      )}
      {!showTableActions && (
        <button
          type="button"
          className="rounded-[4px] bg-hypertasks-purple px-3 py-1.5 text-content text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          onClick={() => openBulkCommand()}
          disabled={isProcessing}
        >
          Open actions
        </button>
      )}
      <span className="text-meta text-text-light-gray">Esc to clear</span>
    </div>
  );
};

export default KanbanBulkActionBar;
