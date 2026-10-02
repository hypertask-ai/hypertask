import { useCallback, useEffect } from "react";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { isFavoriteBoardShortcut } from "@/lib/constants/shortcuts";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { shouldRunArchiveShortcut } from "@/lib/keyboard/archiveShortcutGuard";
import { shouldIgnoreTaskShortcutTarget } from "@/lib/keyboard/taskShortcuts";
import { createTaskFromTableSelection } from "./tableCreateTask";
import useAddDeleteTaskInBoards from "@/hooks/MultiPages/useAddDeleteTaskInBoards";
import { useFlag } from "@/hooks/useFlag";
import type { TableViewProps } from "./tableViewShared";
import type { useTableRows } from "./useTableRows";
import type { useTableState } from "./useTableState";
import type { useTableActions } from "./useTableActions";
import { isTaskRow } from "./tableViewShared";

type Context = Pick<TableViewProps, "_currentProject" | "handleBoardChange" | "_sections" | "enableMyTasksBulkSelection"> &
  Pick<ReturnType<typeof useTableRows>, "rows" | "focusTo" | "expandSection"> &
  Pick<ReturnType<typeof useTableState>, "selectedIndex" | "sections" | "toggleCreateTaskGlobally" | "setShowCommands" | "isApple" | "lastGAt" | "rowShortcutsEnabled" | "showCommands" | "assignTask" | "myTasksBulk" | "timerToggling" | "changeBoardLayout"> &
  Pick<ReturnType<typeof useTableActions>, "runTaskShortcut" | "archiveTaskFromTable" | "toggleSelectedTaskTimer" | "openTask">;

export function useTableKeyboard(context: Context) {
  const {
  _currentProject, rows, selectedIndex, sections, toggleCreateTaskGlobally,
  setShowCommands, isApple, handleBoardChange, _sections, lastGAt,
  rowShortcutsEnabled, showCommands, assignTask, runTaskShortcut, enableMyTasksBulkSelection,
  myTasksBulk, archiveTaskFromTable, timerToggling, toggleSelectedTaskTimer, changeBoardLayout,
  focusTo, openTask, expandSection,
  } = context;


  // HTPR-6175: quick entry creates straight from a title, no modal.
  const quickEntryEnabled = useFlag("htpr-6175-quick-entry-cards");
  const { createItem } = useAddDeleteTaskInBoards();
  const quickCreateTask = (
    title: string,
    projectId: number,
    sectionId: number,
    sectionTitle: string,
  ) =>
    createItem({
      sectionId,
      section: sectionTitle,
      item: { title, description: "", id: -1 },
      position: "bottom",
      createAnother: true,
      projectId,
    });

  const createTaskInCurrentTableContext = useCallback(() => {
    createTaskFromTableSelection({
      hasCurrentProject: Boolean(_currentProject),
      selectedRow: rows[selectedIndex],
      sections,
      toggleCreateTaskGlobally,
    });
  }, [
    _currentProject,
    rows,
    sections,
    selectedIndex,
    toggleCreateTaskGlobally,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommands((prev) => ({ ...prev, show: !prev.show }));
        return;
      }
      // LandingPage renders HomePage and TableView as mutually exclusive siblings.
      // Check this before the modal/input guard, matching the board layout's
      // truly global favorite shortcut while the table layout is active.
      if (
        isFavoriteBoardShortcut(e, isApple) &&
        handleBoardChange
      ) {
        e.preventDefault();
        handleBoardChange(Number(e.code.replace("Digit", "")), _sections);
        return;
      }
      if (
        e.keyCode === KeyCodes.G &&
        !e.shiftKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        lastGAt.current = Date.now();
      }
      if (
        (rowShortcutsEnabled &&
          shouldIgnoreTaskShortcutTarget(e.target as HTMLElement | null)) ||
        returnIfModalOrInputActive() ||
        showCommands.show ||
        assignTask
      )
        return;
      const selectedRow = rows[selectedIndex];
      if (runTaskShortcut(e, selectedRow, selectedIndex)) return;
      // [ctrl/cmd]+[e] archives the selected task. This component also powers
      // My Tasks, so archiveTaskFromTable handles both board cache updates and
      // the cross-board server-data refresh used there.
      // keyCode matches every other Ctrl+E surface; e.key can be unreliable
      // under modifiers on some browsers.
      if ((e.ctrlKey || e.metaKey) && e.keyCode === KeyCodes.E) {
        const row = rows[selectedIndex];
        if (
          enableMyTasksBulkSelection &&
          myTasksBulk &&
          myTasksBulk.selectedCount > 0
        ) {
          e.preventDefault();
          if (!shouldRunArchiveShortcut(e)) return;
          void myTasksBulk.archiveSelected();
          return;
        }
        if (!row || !isTaskRow(row)) return;
        e.preventDefault();
        if (!shouldRunArchiveShortcut(e)) return;
        void archiveTaskFromTable(row.task);
        return;
      }
      if (
        enableMyTasksBulkSelection &&
        myTasksBulk &&
        e.keyCode === KeyCodes.X &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        const row = rows[selectedIndex];
        if (!row || !isTaskRow(row)) return;
        e.preventDefault();
        myTasksBulk.toggleTaskSelection(row.task.id, e.shiftKey);
        return;
      }
      // [c] creates a task; /project is excluded from the global handler because
      // the Kanban surface owns it there, so the table surface must own it too
      if (_currentProject && e.key === "c" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        createTaskInCurrentTableContext();
        return;
      }
      if (
        e.key === "w" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        _currentProject?.timeTrackingEnabled
      ) {
        const row = rows[selectedIndex];
        if (!row || !isTaskRow(row) || timerToggling.current) return;
        e.preventDefault();
        void toggleSelectedTaskTimer(row.task.id);
        return;
      }
      if (!rows.length) return;
      if (_currentProject && e.keyCode === 84 && e.shiftKey) {
        e.preventDefault();
        changeBoardLayout("board");
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        focusTo(selectedIndex + 1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        focusTo(selectedIndex - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[selectedIndex];
        if (row && isTaskRow(row)) openTask(row.task, selectedIndex);
        else if (row?.type === "more") expandSection(row.sid);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [_currentProject, _sections, archiveTaskFromTable, assignTask, changeBoardLayout, createTaskInCurrentTableContext, enableMyTasksBulkSelection, expandSection, focusTo, handleBoardChange, myTasksBulk, openTask, rows, rowShortcutsEnabled, runTaskShortcut, selectedIndex, setShowCommands, showCommands.show, toggleSelectedTaskTimer]);
  return {
  quickEntryEnabled, quickCreateTask,
  };
}
