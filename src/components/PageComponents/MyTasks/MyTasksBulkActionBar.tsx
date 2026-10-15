"use client";

import { Archive, Columns3, Tag, UserRoundPlus } from "lucide-react";

import { CommandMode } from "@/models/enums";
import { useFlag } from "@/hooks/useFlag";
import { MY_TASKS_BULK_SELECTION_FLAG } from "@/lib/flags/keys";
import { useMyTasksBulkSelection } from "@/lib/contexts/MyTasks/BulkSelectionContext";
import { sharedProjectId } from "@/lib/myTasksBulkSelection";

const iconButtonClass =
  "rounded-[4px] p-1.5 text-white-black transition-colors hover:bg-hover-active disabled:cursor-not-allowed disabled:opacity-40";

export const BulkActionButtons = ({
  isProcessing,
  sameBoard = true,
  archiveSelected,
  openBulkCommand,
  buttonClassName = iconButtonClass,
}: {
  isProcessing: boolean;
  sameBoard?: boolean;
  archiveSelected: () => Promise<void>;
  openBulkCommand: (mode?: CommandMode) => void;
  buttonClassName?: string;
}) => (
  <>
    <button
      type="button"
      className={buttonClassName}
      aria-label="Archive selected"
      disabled={isProcessing}
      onClick={() => void archiveSelected()}
    >
      <Archive size={16} strokeWidth={1.5} />
    </button>
    <button
      type="button"
      className={buttonClassName}
      aria-label="Assign selected"
      disabled={isProcessing || !sameBoard}
      title={sameBoard ? undefined : "Select tasks from one board"}
      onClick={() => openBulkCommand(CommandMode.OpenAssignModal)}
    >
      <UserRoundPlus size={16} strokeWidth={1.5} />
    </button>
    <button
      type="button"
      className={buttonClassName}
      aria-label="Label selected"
      disabled={isProcessing || !sameBoard}
      title={sameBoard ? undefined : "Select tasks from one board"}
      onClick={() => openBulkCommand(CommandMode.LabelModal)}
    >
      <Tag size={16} strokeWidth={1.5} />
    </button>
    <button
      type="button"
      className={buttonClassName}
      aria-label="Move selected"
      disabled={isProcessing || !sameBoard}
      title={sameBoard ? undefined : "Select tasks from one board"}
      onClick={() => openBulkCommand(CommandMode.MoveToColumn)}
    >
      <Columns3 size={16} strokeWidth={1.5} />
    </button>
  </>
);

const MyTasksBulkActionBar = () => {
  const bulkSelectionEnabled = useFlag(MY_TASKS_BULK_SELECTION_FLAG);
  const {
    selectedCount,
    selectedTasks,
    failedIds,
    isProcessing,
    archiveSelected,
    openBulkCommand,
    clearSelection,
  } = useMyTasksBulkSelection();

  const sameBoard = sharedProjectId(selectedTasks) !== null;

  return bulkSelectionEnabled && selectedCount > 0 ? (
    <div
      className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-[5px] bg-modalBackground px-3 py-2 text-content text-white-black customshadow-4"
      role="status"
      aria-live="polite"
    >
      <span className="pr-1">
        {selectedCount} selected
        {failedIds.size > 0 ? ` · ${failedIds.size} failed` : ""}
      </span>
      <BulkActionButtons
        isProcessing={isProcessing}
        sameBoard={sameBoard}
        archiveSelected={archiveSelected}
        openBulkCommand={openBulkCommand}
      />
      <button
        type="button"
        className="ml-1 text-meta text-text-light-gray hover:text-white-black"
        onClick={clearSelection}
      >
        Esc
      </button>
    </div>
  ) : null;
};

export default MyTasksBulkActionBar;
