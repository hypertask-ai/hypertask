"use client";

import { Plus, Sparkles } from "lucide-react";
import { useSetRecoilState } from "@/lib/state";
import { showCreateTaskModalAtom } from "@/store";
import { useGlobalUIState } from "../ProviderGlobal/useGlobalUIState";
import MobileFloatingActionButton from "./MobileFloatingActionButton";

type MobileCreateTaskButtonProps = {
  bottomOffset?: number;
};

const MobileCreateTaskButton = ({
  bottomOffset,
}: MobileCreateTaskButtonProps) => {
  const setCreateTaskModal = useSetRecoilState(showCreateTaskModalAtom);
  const { openAIChatInterface } = useGlobalUIState();

  return (
    <>
      <MobileFloatingActionButton
        ariaLabel="Ask AI"
        bottomOffset={bottomOffset}
        icon={
          <Sparkles
            size={18}
            strokeWidth={1.75}
            className="text-hypertasks-ai-purple"
            aria-hidden="true"
          />
        }
        onClick={openAIChatInterface}
        size="secondary"
        stackOffset={60}
      />
      <MobileFloatingActionButton
        ariaLabel="Create task"
        bottomOffset={bottomOffset}
        icon={<Plus size={20} strokeWidth={1.75} aria-hidden="true" />}
        onClick={() => setCreateTaskModal({ show: true })}
      />
    </>
  );
};

export default MobileCreateTaskButton;
