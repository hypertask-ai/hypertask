import React from "react";

import { useKanbanBulkSelection } from "@/lib/contexts/Kanban/BulkSelectionContext";

const KanbanBulkActionBar = () => {
  const {
    selectedCount,
    failedIds,
    isProcessing,
    openBulkCommand,
  } = useKanbanBulkSelection();

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
