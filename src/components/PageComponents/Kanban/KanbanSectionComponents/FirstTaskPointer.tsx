import React from "react";
import { useQuery } from "@tanstack/react-query";
import KBDElement from "@/components/Common/kbd";
import Tooltip from "@/components/Common/Tooltip";
import { useFlag } from "@/hooks/useFlag";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7511-signup-straight-to-board";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG } from "@/lib/flags/keys";
import { useSetRecoilState } from "@/lib/state";
import { getShortcutDisplay } from "@/lib/utils/keyboardShortcuts";
import { CommandMode } from "@/models/enums";
import { activeSectionAtom, activeSectionIdAtom, showCommandsAtom } from "@/store";

type Props = {
  projectId: number;
  sectionId: number;
  sectionIndex: number;
  taskIds: number[];
  ready: boolean;
  writable: boolean;
  filtered: boolean;
  kanban: boolean;
};

type PointerState = { eligible: boolean; starterTaskId?: number; sectionId?: number };

export default function FirstTaskPointer({ projectId, sectionId, sectionIndex, taskIds, ready, writable, filtered, kanban }: Props) {
  const enabled = useFlag(HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG);
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const isApple = useDeviceContext();
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const setActiveSection = useSetRecoilState(activeSectionAtom);
  const setActiveSectionId = useSetRecoilState(activeSectionIdAtom);
  const canShow = enabled && composeEnabled && ready && writable && !filtered && kanban;
  const { data, isFetching } = useQuery<PointerState>({
    queryKey: ["first-task-pointer", projectId, taskIds],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/projects/first-task-pointer?projectId=${projectId}`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("First-task pointer unavailable");
      return response.json();
    },
    enabled: canShow,
    retry: false,
  });
  if (!canShow || isFetching || !data?.eligible || data.sectionId !== sectionId || taskIds.some((id) => id !== data.starterTaskId)) return null;

  return (
    <button
      type="button"
      aria-keyshortcuts={isApple ? "Meta+J" : "Control+J"}
      className="group absolute right-0 top-full z-20 mt-2 flex w-max max-w-[280px] items-center gap-2 rounded border border-light-black-border-1 bg-labelComponent px-2 py-[6px] text-dense font-semibold text-white-black shadow-md hover:bg-hover-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-white-black"
      onClick={(event) => {
        event.stopPropagation();
        setActiveSection(sectionIndex);
        setActiveSectionId(sectionId);
        setShowCommands({ show: true, mode: CommandMode.Command, paletteTab: "compose" });
      }}
    >
      <span>Write your first task here</span>
      <span className="flex shrink-0">
        {getShortcutDisplay({ key: 74, modifiers: ["ctrl"], description: "New Task" }, isApple).map((key) => (
          <KBDElement key={key} content={key} className="px-1 text-dense" />
        ))}
      </span>
      <Tooltip portal left={0} bottom={-45} text="New Task" keyCombination={[]} />
    </button>
  );
}
