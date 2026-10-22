import React, { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import KBDElement from "@/components/Common/kbd";
import { useFlag } from "@/hooks/useFlag";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { HTPR_7549_FIRST_TASK_POINTER_FLAG } from "@/lib/flags/keys";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG } from "@/lib/flags/keys";
import { useSetRecoilState } from "@/lib/state";
import { getShortcutDisplay } from "@/lib/utils/keyboardShortcuts";
import { CommandMode } from "@/models/enums";
import { activeSectionAtom, activeSectionIdAtom, showCommandsAtom } from "@/store";

type Props = {
  projectId: number;
  sectionId: number;
  sectionIndex: number;
  taskIds: number[] | null;
  ready: boolean;
  writable: boolean;
  filtered: boolean;
};

type PointerState = { eligible: boolean; starterTaskId?: number; sectionId?: number };

export default function FirstTaskPointer({ projectId, sectionId, sectionIndex, taskIds, ready, writable, filtered }: Props) {
  const enabled = useFlag(HTPR_7549_FIRST_TASK_POINTER_FLAG);
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const isApple = useDeviceContext();
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const setActiveSection = useSetRecoilState(activeSectionAtom);
  const setActiveSectionId = useSetRecoilState(activeSectionIdAtom);
  const queryClient = useQueryClient();
  const canShow = enabled && composeEnabled && ready && writable && !filtered;
  const canQuery = canShow && taskIds !== null && taskIds.length <= 1;
  const { data, isPending } = useQuery<PointerState>({
    queryKey: ["first-task-pointer", projectId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/projects/first-task-pointer?projectId=${projectId}`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("First-task pointer unavailable");
      return response.json();
    },
    enabled: canQuery,
    retry: false,
  });
  const hasRealTask = taskIds === null || taskIds.some((id) => id !== data?.starterTaskId);
  useEffect(() => {
    if (canShow && data?.eligible && hasRealTask) {
      void queryClient.cancelQueries({ queryKey: ["first-task-pointer", projectId], exact: true });
      queryClient.setQueryData<PointerState>(["first-task-pointer", projectId], { ...data, eligible: false });
    }
  }, [canShow, data, hasRealTask, projectId, queryClient]);
  if (!canQuery || isPending || !data?.eligible || data.sectionId !== sectionId || hasRealTask) return null;

  return (
    <button
      type="button"
      aria-keyshortcuts={isApple ? "Meta+J" : "Control+J"}
      className="absolute right-0 top-[100%] z-20 mt-2 flex w-max max-w-[280px] items-center gap-2 rounded bg-shadcn-primary px-2 py-[6px] text-dense font-semibold text-primary-foreground shadow-md hover:bg-shadcn-primary/90 focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none"
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
    </button>
  );
}
