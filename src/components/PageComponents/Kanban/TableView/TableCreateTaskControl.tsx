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
  projectId: number,
  sectionId: number,
  sectionTitle: string,
) => Promise<boolean>;

export type TableCreateTaskControlProps = {
  hasCurrentProject: boolean;
  projectId?: number;
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
> & { currentProject: { id?: number } | null | undefined };

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
  projectId: Number.isSafeInteger(currentProject?.id) ? currentProject?.id : undefined,
  rows,
  selectedIndex,
  sections,
  toggleCreateTaskGlobally,
  quickEntryEnabled,
  quickCreateTask,
});

export const TableCreateTaskControl = ({
  hasCurrentProject,
  projectId,
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
    { projectId: number; sectionId: number; sectionTitle: string } | null
  >(null);
  const [draftTitle, setDraftTitle] = useState("");

  const selectedRow = rows[selectedIndex];
  const selectedSectionPayload = resolveTableCreateTaskSectionPayload(
    selectedRow?.sid,
    sections,
  );
  const labels = getTableCreateTaskButtonLabelsForSelection(selectedRow, sections);
  const quickEntry = Boolean(quickEntryEnabled && quickCreateTask && projectId);
  const activeTarget = openTarget?.projectId === projectId ? openTarget : null;

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
    if (!hasCurrentProject || !projectId || !selectedSectionPayload) return;
    setOpenTarget({
      projectId,
      sectionId: selectedSectionPayload.sectionId,
      sectionTitle: selectedSectionPayload.sectionTitle,
    });
  };

  if (quickEntry && activeTarget) {
    return (
      <div className="px-[20px] pb-2 md:px-5">
        <NewTask
          title={draftTitle}
          onTitleChange={setDraftTitle}
          inputRef={{ current: null }}
          onCancelCreate={() => setOpenTarget(null)}
          invokeCreateItem={(title) =>
            quickCreateTask!(
              title,
              activeTarget.projectId,
              activeTarget.sectionId,
              activeTarget.sectionTitle,
            )
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
