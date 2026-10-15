import React, { useContext } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7260_KANBAN_SELECT_ALL_FLAG } from "@/lib/flags/keys";
import { BulkActionButtons } from "@/components/PageComponents/MyTasks/MyTasksBulkActionBar";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

import { useKanbanBulkSelection } from "@/lib/contexts/Kanban/BulkSelectionContext";

const ghostIconButtonClass =
  "rounded-[4px] p-1.5 text-text-light-gray transition-colors hover:bg-hover-active hover:text-white-black disabled:cursor-not-allowed disabled:opacity-40";

const KanbanBulkActionBar = () => {
  const isMobile = useContext(MobileViewContext);
  const selectAllEnabled = useFlag(HTPR_7260_KANBAN_SELECT_ALL_FLAG);
  const {
    selectedCount,
    failedIds,
    isProcessing,
    openBulkCommand,
    archiveSelected,
    clearSelection,
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
      {selectAllEnabled && (
        <BulkActionButtons
          isProcessing={isProcessing}
          archiveSelected={archiveSelected}
          openBulkCommand={openBulkCommand}
          buttonClassName={`${ghostIconButtonClass} ${isMobile ? MOBILE_TARGET : ""}`}
        />
      )}
      <button
        type="button"
        className="rounded-[4px] bg-hypertasks-purple px-3 py-1.5 text-content text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        onClick={() => openBulkCommand()}
        disabled={isProcessing}
      >
        Open actions
      </button>
      {selectAllEnabled ? (
        <button
          type="button"
          className="ml-1 text-meta text-text-light-gray hover:text-white-black"
          onClick={clearSelection}
        >
          Esc
        </button>
      ) : (
        <span className="text-meta text-text-light-gray">Esc to clear</span>
      )}
    </div>
  );
};

export default KanbanBulkActionBar;
