"use client";

import { useState } from "react";
import AddExistingAgentPicker from "./AddExistingAgentPicker";

type Props = {
  projectId: number;
  boardName: string;
  boardTeamId: string | null;
};

const AddExistingAgentButton = ({ projectId, boardName, boardTeamId }: Props) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="min-h-11 text-dense font-medium text-hypertasks-purple"
        onClick={() => setIsOpen(true)}
      >
        Add existing agent
      </button>
      {isOpen && (
        <AddExistingAgentPicker
          key={projectId}
          projectId={projectId}
          boardName={boardName}
          boardTeamId={boardTeamId}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
};

export default AddExistingAgentButton;
