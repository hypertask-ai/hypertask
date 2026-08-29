import { useCallback } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { showArchivedOnBoardAtom, pendingShowArchivedAtom } from "@/store";
import { IProject } from "@/models/model";
import {
  getActiveShowArchivedOverrideFromProject,
  resolveShowArchivedForBoard,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import useKanbanViews from "./Views/useKanbanViews";

// "Show archived tasks" used to live only in a persisted browser atom, so it
// reset on navigation and could never be saved with a view (HTPR-5540). The
// view override is now the source of truth; the atom is the fallback for a
// board whose view chain has never pinned the setting.
//
// A pending toggle outranks both: the view write is async, so until it lands
// the saved override still reports the old value and a second toggle would
// otherwise re-send the first one's result.

export const useShowArchivedOnBoard = (project?: IProject | null): boolean => {
  const browserPreference = useRecoilValue(showArchivedOnBoardAtom);
  const pending = useRecoilValue(pendingShowArchivedAtom);
  return resolveShowArchivedForBoard(project, pending, browserPreference);
};

export const useToggleShowArchivedOnBoard = (project?: IProject | null) => {
  const [browserPreference, setBrowserPreference] = useRecoilState(
    showArchivedOnBoardAtom
  );
  const [pending, setPending] = useRecoilState(pendingShowArchivedAtom);
  const { saveShowArchivedAPI } = useKanbanViews(project ?? null);

  return useCallback(() => {
    const next = !resolveShowArchivedForBoard(project, pending, browserPreference);
    // The atom is an unscoped browser-wide fallback, so only a board with no
    // view-backed setting may write it. Otherwise toggling a pinned view would
    // flip archived visibility on every unrelated unpinned board.
    if (!project || getActiveShowArchivedOverrideFromProject(project) === null) {
      setBrowserPreference(next);
    }
    if (project) {
      // The optimistic value carries the board re-render instead, scoped to
      // this project, until the unsaved-view write lands.
      setPending({ projectId: project.id, value: next });
      void saveShowArchivedAPI(project, next).finally(() =>
        // Only drop the optimistic value if it is still ours; a newer toggle
        // owns the board state and clears itself when its own write returns.
        setPending((current) =>
          current && current.projectId === project.id && current.value === next
            ? null
            : current
        )
      );
    }
    return next;
  }, [
    browserPreference,
    pending,
    project,
    saveShowArchivedAPI,
    setBrowserPreference,
    setPending,
  ]);
};
