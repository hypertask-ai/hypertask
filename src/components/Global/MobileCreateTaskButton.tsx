"use client";

import { Plus } from "lucide-react";
import { useSetRecoilState } from "@/lib/state";
import { showCreateTaskModalAtom } from "@/store";

const MobileCreateTaskButton = () => {
  const setCreateTaskModal = useSetRecoilState(showCreateTaskModalAtom);

  return (
    <button
      type="button"
      aria-label="Create task"
      onClick={() => setCreateTaskModal({ show: true })}
      className="fixed right-4 z-[200] inline-flex min-h-11 items-center gap-2 rounded-full border border-border-light-gray-thin bg-modalBackground px-4 text-content font-semibold text-white-black shadow-customshadow-2 transition-colors hover:bg-hover-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-container-outline md:hidden"
      style={{
        bottom:
          "calc(var(--mobile-dock-h, 0px) + 16px + env(safe-area-inset-bottom))",
      }}
    >
      <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
      <span>New task</span>
    </button>
  );
};

export default MobileCreateTaskButton;
