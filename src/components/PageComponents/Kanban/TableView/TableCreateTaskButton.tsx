import React from "react";
import { Plus } from "lucide-react";

type TableCreateTaskButtonProps = {
  hasCurrentProject: boolean;
  disabled: boolean;
  labels: {
    ariaLabel: string;
    title: string;
  };
  onCreate: () => void;
};

export const TableCreateTaskButton = ({
  hasCurrentProject,
  disabled,
  labels,
  onCreate,
}: TableCreateTaskButtonProps) => {
  if (!hasCurrentProject) return null;

  return (
    <div className="flex justify-end px-[20px] pb-2 md:px-5">
      <button
        type="button"
        onClick={onCreate}
        disabled={disabled}
        aria-label={labels.ariaLabel}
        title={labels.title}
        className="inline-flex h-8 items-center gap-1.5 rounded-[4px] px-2.5 text-dense font-medium text-text-light-gray transition-colors hover:bg-hover-active hover:text-white-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white-black disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus aria-hidden="true" size={14} strokeWidth={1.75} />
        <span>New task</span>
      </button>
    </div>
  );
};
