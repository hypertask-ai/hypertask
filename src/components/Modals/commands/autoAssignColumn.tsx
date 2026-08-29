import { useState } from "react";
import AssignModal from "@/components/Modals/AssignToUser/AssignToUser";
import { IAgent, IProject, ISection, IUser } from "@/models/model";
import {
  hasNoSectionAutoAssign,
  sectionAutoAssignTargetFor,
} from "@/lib/sectionAutoAssign";
import MoveToColumn from "./moveToColumn";

type Props = {
  project: IProject;
  onClose: () => void;
  onSelect: (
    sectionId: number,
    target: { autoAssignUserId: number | null; autoAssignAgentId: string | null },
  ) => void;
};

const CLEAR_AUTO_ASSIGN = {
  id: 0,
  displayName: "Clear auto-assign",
  assigned: false,
} as IUser;

const AutoAssignColumn = ({ project, onClose, onSelect }: Props) => {
  const [selectedSection, setSelectedSection] = useState<ISection | null>(null);

  if (!selectedSection) {
    return (
      <MoveToColumn
        mode="CreatingTask"
        projectId={project.id}
        title="Auto-assign: choose a column"
        moveTaskToColumnHandler={onClose}
        callback={setSelectedSection}
      />
    );
  }

  const savedSection = project.section?.find(
    (section) => section.id === selectedSection.id
  );
  const autoAssignUserId = savedSection?.autoAssignUserId ?? null;
  const autoAssignAgentId = savedSection?.autoAssignAgentId ?? null;

  return (
    <AssignModal
      mode="Create"
      project={project}
      title={`Auto-assign for ${selectedSection.section_title}`}
      includeAgents
      selectedUserIds={autoAssignUserId ? [autoAssignUserId] : []}
      selectedAgentIds={autoAssignAgentId ? [autoAssignAgentId] : []}
      extraUsers={[
        {
          ...CLEAR_AUTO_ASSIGN,
          assigned: hasNoSectionAutoAssign(savedSection ?? {}),
        },
      ]}
      assignees={[]}
      onClose={(assignee?: IUser | IAgent) => {
        if (!assignee) return setSelectedSection(null);
        onSelect(selectedSection.id!, sectionAutoAssignTargetFor(assignee));
      }}
    />
  );
};

export default AutoAssignColumn;
