import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import type { ISection } from "@/models/model";
import type { BoardTasksPayload } from "@/lib/firstScreen/boardPayload";
import { reconcileActiveBoardTasks } from "@/lib/boardSync/reconcileActiveBoardQuery";
import { useQueryClient } from "@tanstack/react-query";
import globalAPIHandlers from "@/utils/api/global";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";

type Snapshot = { projectId: number; sectionId: number; column: string; tasks: BoardTasksPayload["tasks"] };
type ArchiveState =
  | { kind: "pick" }
  | { kind: "loading"; column: string }
  | { kind: "confirm" | "archiving"; snapshot: Snapshot };

export function useArchiveColumn({ enabled, active, projectId, userId, onClose }: {
  enabled: boolean;
  active: boolean;
  projectId?: number;
  userId: number;
  onClose: () => void;
}) {
  const [state, setState] = useState<ArchiveState>({ kind: "pick" });
  const busy = useRef(false);
  const queryClient = useQueryClient();
  const { deleteTodo: registerUndo } = UpdateKanban();

  const close = useCallback(() => {
    if (busy.current) return;
    setState({ kind: "pick" });
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const blockPaletteSwitch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !["KeyK", "KeyJ"].includes(event.code)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", blockPaletteSwitch, true);
    return () => window.removeEventListener("keydown", blockPaletteSwitch, true);
  }, [active, close]);

  const prepare = async (section: ISection) => {
    const sectionId = section.id ?? section.sectionId;
    if (!enabled || !projectId || sectionId == null || busy.current) return;
    busy.current = true;
    setState({ kind: "loading", column: section.section_title });
    try {
      const { data } = await axios.post<BoardTasksPayload>("/api/projects/boardTasks", { projectId });
      const tasks = data.tasks.filter((task) => task.projectId === projectId && task.sectionId === sectionId && task.status === "Normal");
      setState({ kind: "confirm", snapshot: { projectId, sectionId, column: section.section_title, tasks } });
    } catch {
      toast.error("Could not load this column's tickets");
      setState({ kind: "pick" });
    } finally {
      busy.current = false;
    }
  };

  const confirm = async () => {
    if (!enabled || !active || state.kind !== "confirm" || state.snapshot.projectId !== projectId || busy.current || state.snapshot.tasks.length === 0) return;
    const { snapshot } = state;
    busy.current = true;
    setState({ kind: "archiving", snapshot });
    const archived: number[] = [];
    const failed: string[] = [];
    try {
      for (const task of snapshot.tasks) {
        try {
          await globalAPIHandlers.archiveTask(task.id, "Archive", { projectId: snapshot.projectId, sectionId: snapshot.sectionId });
          archived.push(task.id);
        } catch {
          failed.push(task.title);
        }
      }
      if (archived.length > 0) {
        registerUndo(`Archived ${archived.length} tickets from ${snapshot.column}`, { taskIds: archived, projectId: snapshot.projectId });
      }
      if (failed.length > 0) toast.error(`${failed.length} tickets not archived: ${failed.join(", ")}`);
      try {
        await reconcileActiveBoardTasks(queryClient, snapshot.projectId, userId);
      } catch {
        toast.error("Reload the board to see updated tickets");
      }
    } finally {
      busy.current = false;
      close();
    }
  };

  return { state, prepare, confirm, close };
}
