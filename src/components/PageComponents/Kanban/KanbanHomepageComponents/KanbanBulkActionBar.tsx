import React, { useContext } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7260_KANBAN_SELECT_ALL_FLAG } from "@/lib/flags/keys";
import { BulkActionButtons } from "@/components/PageComponents/MyTasks/MyTasksBulkActionBar";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

import { useKanbanBulkSelection } from "@/lib/contexts/Kanban/BulkSelectionContext";

const ghostIconButtonClass =
  "rounded-[4px] p-1.5 text-text-light-gray transition-colors hover:bg-hover-active hover:text-white-black disabled:cursor-not-allowed disabled:opacity-40";

const desktopBarClass =
  "fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-[5px] bg-modalBackground px-3 py-2 text-content text-white-black customshadow-4";
const phoneBarClass =
  "fixed inset-x-2 z-[210] flex flex-wrap items-center justify-center gap-2 rounded-[5px] bg-modalBackground px-3 py-2 text-content text-white-black customshadow-4";
const desktopFlaggedBarStyle = { bottom: "var(--quick-tips-clearance, 20px)" };
const phoneBarStyle = { bottom: "calc(var(--mobile-dock-h, 0px) + 16px + env(safe-area-inset-bottom))" };

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

  const phoneBar = selectAllEnabled && isMobile;
  let barStyle: React.CSSProperties | undefined;
  if (phoneBar) barStyle = phoneBarStyle;
  else if (selectAllEnabled) barStyle = desktopFlaggedBarStyle;

  return (
    <div
      className={phoneBar ? phoneBarClass : desktopBarClass}
      style={barStyle}
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
