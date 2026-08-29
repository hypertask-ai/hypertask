import React from "react";
import {
  createTaskFromTableSelection,
  getTableCreateTaskButtonLabelsForSelection,
  resolveTableCreateTaskSectionPayload,
  type TableCreateTaskRow,
  type TableCreateTaskSection,
  type ToggleCreateTaskGlobally,
} from "./tableCreateTask";
import { TableCreateTaskButton } from "./TableCreateTaskButton";

export type TableCreateTaskControlProps = {
  hasCurrentProject: boolean;
  rows: readonly TableCreateTaskRow[];
  selectedIndex: number;
  sections: readonly TableCreateTaskSection[];
  toggleCreateTaskGlobally: ToggleCreateTaskGlobally;
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
}: TableCreateTaskControlInput): TableCreateTaskControlProps => ({
  hasCurrentProject: Boolean(currentProject),
  rows,
  selectedIndex,
  sections,
  toggleCreateTaskGlobally,
});

export const TableCreateTaskControl = ({
  hasCurrentProject,
  rows,
  selectedIndex,
  sections,
  toggleCreateTaskGlobally,
}: TableCreateTaskControlProps) => {
  const selectedRow = rows[selectedIndex];
  const selectedSectionPayload = resolveTableCreateTaskSectionPayload(
    selectedRow?.sid,
    sections,
  );
  const labels = getTableCreateTaskButtonLabelsForSelection(selectedRow, sections);
  const onCreate = () =>
    createTaskFromTableSelection({
      hasCurrentProject,
      selectedRow,
      sections,
      toggleCreateTaskGlobally,
    });
  return (
    <TableCreateTaskButton
      hasCurrentProject={hasCurrentProject}
      disabled={!selectedSectionPayload}
      labels={labels}
      onCreate={onCreate}
    />
  );
};
