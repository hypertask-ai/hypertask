import React, { useState } from "react";
import {
  createTaskFromTableSelection,
  getTableCreateTaskButtonLabelsForSelection,
  resolveTableCreateTaskSectionPayload,
  type TableCreateTaskRow,
  type TableCreateTaskSection,
  type ToggleCreateTaskGlobally,
} from "./tableCreateTask";
import { TableCreateTaskButton } from "./TableCreateTaskButton";
import NewTask from "../../../Common/newTask";

export type QuickCreateTask = (
  title: string,
  sectionId: number,
  sectionTitle: string,
) => Promise<boolean>;

export type TableCreateTaskControlProps = {
  hasCurrentProject: boolean;
  rows: readonly TableCreateTaskRow[];
  selectedIndex: number;
  sections: readonly TableCreateTaskSection[];
  toggleCreateTaskGlobally: ToggleCreateTaskGlobally;
  // HTPR-6175 quick entry. Both come from TableView so this stays a plain component.
  quickEntryEnabled?: boolean;
  quickCreateTask?: QuickCreateTask;
};

export type TableCreateTaskControlInput = Omit<
  TableCreateTaskControlProps,
  "hasCurrentProject"
> & { currentProject: unknown };

export const getTableCreateTaskControlProps = ({
  currentProject,
  rows,
  selectedIndex,
  sections,
  toggleCreateTaskGlobally,
  quickEntryEnabled,
  quickCreateTask,
}: TableCreateTaskControlInput): TableCreateTaskControlProps => ({
  hasCurrentProject: Boolean(currentProject),
  rows,
  selectedIndex,
  sections,
  toggleCreateTaskGlobally,
  quickEntryEnabled,
  quickCreateTask,
});

export const TableCreateTaskControl = ({
  hasCurrentProject,
  rows,
  selectedIndex,
  sections,
  toggleCreateTaskGlobally,
  quickEntryEnabled,
  quickCreateTask,
}: TableCreateTaskControlProps) => {
  // Locked in when the box opens, so changing the selected row mid-typing
  // cannot send the card to a different column.
  const [openTarget, setOpenTarget] = useState<
    { sectionId: number; sectionTitle: string } | null
  >(null);
  const [draftTitle, setDraftTitle] = useState("");

  const selectedRow = rows[selectedIndex];
  const selectedSectionPayload = resolveTableCreateTaskSectionPayload(
    selectedRow?.sid,
    sections,
  );
  const labels = getTableCreateTaskButtonLabelsForSelection(selectedRow, sections);
  const quickEntry = Boolean(quickEntryEnabled && quickCreateTask);

  const onCreate = () => {
    if (!quickEntry) {
      createTaskFromTableSelection({
        hasCurrentProject,
        selectedRow,
        sections,
        toggleCreateTaskGlobally,
      });
      return;
    }
    if (!hasCurrentProject || !selectedSectionPayload) return;
    setOpenTarget({
      sectionId: selectedSectionPayload.sectionId,
      sectionTitle: selectedSectionPayload.sectionTitle,
    });
  };

  if (quickEntry && openTarget) {
    return (
      <div className="px-[20px] pb-2 md:px-5">
        <NewTask
          initialTitle={draftTitle}
          inputRef={{ current: null }}
          onCancelCreate={(title) => {
            setDraftTitle(title);
            setOpenTarget(null);
          }}
          invokeCreateItem={(title) =>
            quickCreateTask!(title, openTarget.sectionId, openTarget.sectionTitle)
          }
        />
      </div>
    );
  }

  return (
    <TableCreateTaskButton
      hasCurrentProject={hasCurrentProject}
      disabled={!selectedSectionPayload}
      labels={labels}
      onCreate={onCreate}
    />
  );
};
