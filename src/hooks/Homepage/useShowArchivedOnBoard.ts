import { useCallback } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { showArchivedOnBoardAtom, pendingShowArchivedAtom } from "@/store";
import { IProject } from "@/models/model";
import {
  getActiveShowArchivedOverrideFromProject,
  resolveShowArchivedForBoard,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import useKanbanViews from "./Views/useKanbanViews";


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
    if (!project || getActiveShowArchivedOverrideFromProject(project) === null) {
      setBrowserPreference(next);
    }
    if (project) {
      setPending({ projectId: project.id, value: next });
      void saveShowArchivedAPI(project, next).finally(() =>
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
