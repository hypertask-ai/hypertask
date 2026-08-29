import { useLayoutEffect, useState } from "react";
import {
  getSelectionDetails,
  resolveTargets,
  isSelectionWithinTarget,
} from ".";
import { SelectionDetails, TargetSelector } from "./types";
import { debounce } from "@/utils/helperFunctions/helperFunctions";

export function useGetSelectionDetails(target: TargetSelector) {
  const [state, setState] = useState<SelectionDetails | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onSelectionChange = () => {
    const selection = getSelectionDetails();
    if (!selection?.range) {
      setState(null);
    } else {
      const targets = resolveTargets(target);
      if (isSelectionWithinTarget(targets, selection)) {
        setState(selection);
      } else {
        setState(null);
      }
    }
  };

  useLayoutEffect(() => {
    const updateAnchorPos = () => {
      const targets = resolveTargets(target);
      const selection = getSelectionDetails();
      if (isSelectionWithinTarget(targets, selection)) {
        setState(selection);
      } else {
        setState(null);
      }
    };

    const onWindowScroll = () => {
      updateAnchorPos();
    };

    // Debounce the scroll and resize events
    const debouncedScroll = debounce(onWindowScroll, 100);
    const debouncedResize = debounce(updateAnchorPos, 100);

    document.addEventListener("mouseup", updateAnchorPos);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("resize", debouncedResize);
    window.addEventListener("scroll", debouncedScroll, { capture: true });

    return () => {
      document.removeEventListener("mouseup", updateAnchorPos);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("resize", debouncedResize);
      window.removeEventListener("scroll", debouncedScroll, { capture: true });
    };
  }, [onSelectionChange, target]);

  return state;
}


export default useGetSelectionDetails;
