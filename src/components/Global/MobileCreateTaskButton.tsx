"use client";

import { Plus } from "lucide-react";
import { useSetRecoilState } from "@/lib/state";
import { showCreateTaskModalAtom } from "@/store";
import MobileFloatingActionButton from "./MobileFloatingActionButton";

const MobileCreateTaskButton = () => {
  const setCreateTaskModal = useSetRecoilState(showCreateTaskModalAtom);

  return (
    <MobileFloatingActionButton
      ariaLabel="Create task"
      icon={<Plus size={20} strokeWidth={1.75} aria-hidden="true" />}
      label="New task"
      onClick={() => setCreateTaskModal({ show: true })}
    />
  );
};

export default MobileCreateTaskButton;
