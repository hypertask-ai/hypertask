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
        className="min-h-11 rounded-sm px-2 text-dense font-semibold text-text-light-gray transition hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none"
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
