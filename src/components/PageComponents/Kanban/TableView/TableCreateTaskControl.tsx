import React, { useEffect, useState } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6902_N_QUICK_ADD_FLAG } from "@/lib/flags/keys";
import {
  createTaskFromTableSelection,
  getTableCreateTaskButtonLabelsForSelection,
  resolveTableCreateTaskSectionPayload,
  tableSectionId,
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
  const nQuickAddEnabled = useFlag(HTPR_6902_N_QUICK_ADD_FLAG);
  const [openTarget, setOpenTarget] = useState<
    { projectId: number; sectionId: number; sectionTitle: string } | null
  >(null);
  const [draft, setDraft] = useState<{ projectId?: number; title: string }>({ title: "" });

  const selectedRow = rows[selectedIndex];
  const selectedSectionPayload = resolveTableCreateTaskSectionPayload(
    selectedRow?.sid,
    sections,
  );
  const labels = getTableCreateTaskButtonLabelsForSelection(selectedRow, sections);
  const quickEntry = Boolean(quickEntryEnabled && quickCreateTask && projectId);
  const activeTarget = openTarget?.projectId === projectId ? openTarget : null;

  useEffect(nQuickAddEnabled ? () => {
    if (!quickEntry || !hasCurrentProject || !projectId) return;
    const openQuickEntry = () => {
      const payload = selectedSectionPayload ?? resolveTableCreateTaskSectionPayload(
        sections[0] && tableSectionId(sections[0]), sections,
      );
      if (!payload) return;
      setOpenTarget({ projectId, sectionId: payload.sectionId, sectionTitle: payload.sectionTitle });
    };
    document.addEventListener("OPEN_TABLE_QUICK_ENTRY", openQuickEntry);
    return () => document.removeEventListener("OPEN_TABLE_QUICK_ENTRY", openQuickEntry);
  } : () => {}, [nQuickAddEnabled, quickEntry, hasCurrentProject, projectId, selectedSectionPayload, sections]);

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
      <div className="px-5 pb-2">
        <NewTask
          title={draft.projectId === projectId ? draft.title : ""}
          onTitleChange={(title) => setDraft({ projectId, title })}
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
      labels={nQuickAddEnabled && quickEntry
        ? { ...labels, title: labels.title.replace("(C)", "(N / Shift+C)") }
        : labels}
      onCreate={onCreate}
    />
  );
};
