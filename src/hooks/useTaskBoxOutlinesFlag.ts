import { useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7194_TASK_BOX_OUTLINES_FLAG } from "@/lib/flags/keys";

// HTPR-7194: CSS cannot read flags, so mirror the flag onto <html> and scope
// the task page box outlines in globals.scss under html[data-task-box-outlines].
export function useTaskBoxOutlinesFlag() {
  const enabled = useFlag(HTPR_7194_TASK_BOX_OUTLINES_FLAG);
  useEffect(() => {
    const root = document.documentElement.dataset;
    if (enabled) root.taskBoxOutlines = "1";
    else delete root.taskBoxOutlines;
    return () => { delete root.taskBoxOutlines; };
  }, [enabled]);
}
