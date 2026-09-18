import { useLayoutEffect, useRef } from "react";
import {
  scrollBoardToShowFocusFromLeft,
  shouldRevealFocusOnViewSwitch,
  type ViewSwitchScrollState,
} from "@/utils/helperFunctions/Views/scrollBoardColumnIntoView";

const useRevealFocusOnViewSwitch = ({
  projectId,
  viewId,
  getFocusedTaskId,
}: {
  projectId?: number;
  viewId?: string;
  getFocusedTaskId: () => number | null;
}) => {
  const previousRef = useRef<ViewSwitchScrollState | null>(null);

  useLayoutEffect(() => {
    const next = { projectId, viewId };
    if (shouldRevealFocusOnViewSwitch(previousRef.current, next)) {
      scrollBoardToShowFocusFromLeft(getFocusedTaskId());
    }
    previousRef.current = next;
  }, [getFocusedTaskId, projectId, viewId]);
};

export default useRevealFocusOnViewSwitch;
