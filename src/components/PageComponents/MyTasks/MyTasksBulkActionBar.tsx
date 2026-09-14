"use client";

import { Archive, Columns3, Tag, UserRoundPlus } from "lucide-react";

import { CommandMode } from "@/models/enums";
import { useMyTasksBulkSelection } from "@/lib/contexts/MyTasks/BulkSelectionContext";

const iconButtonClass =
  "rounded-[4px] p-1.5 text-white-black transition-colors hover:bg-hover-active disabled:cursor-wait disabled:opacity-60";

const MyTasksBulkActionBar = () => {
  const {
    selectedCount,
    failedIds,
    isProcessing,
    archiveSelected,
    openBulkCommand,
    clearSelection,
  } = useMyTasksBulkSelection();

  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-[5px] bg-modalBackground px-3 py-2 text-content text-white-black customshadow-4"
      role="status"
      aria-live="polite"
    >
      <span className="pr-1">
        {selectedCount} selected
        {failedIds.size > 0 ? ` · ${failedIds.size} failed` : ""}
      </span>
      <button
        type="button"
        className={iconButtonClass}
        aria-label="Archive selected"
        disabled={isProcessing}
        onClick={() => void archiveSelected()}
      >
        <Archive size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className={iconButtonClass}
        aria-label="Assign selected"
        disabled={isProcessing}
        onClick={() => openBulkCommand(CommandMode.OpenAssignModal)}
      >
        <UserRoundPlus size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className={iconButtonClass}
        aria-label="Label selected"
        disabled={isProcessing}
        onClick={() => openBulkCommand(CommandMode.LabelModal)}
      >
        <Tag size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className={iconButtonClass}
        aria-label="Move selected"
        disabled={isProcessing}
        onClick={() => openBulkCommand(CommandMode.MoveToColumn)}
      >
        <Columns3 size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="ml-1 text-meta text-text-light-gray hover:text-white-black"
        onClick={clearSelection}
      >
        Esc
      </button>
    </div>
  );
};

export default MyTasksBulkActionBar;
