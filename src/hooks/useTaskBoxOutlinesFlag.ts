import { useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7194_TASK_BOX_OUTLINES_FLAG } from "@/lib/flags/keys";

export function useTaskBoxOutlinesFlag() {
  const enabled = useFlag(HTPR_7194_TASK_BOX_OUTLINES_FLAG);
  useEffect(() => {
    const root = document.documentElement.dataset;
    if (enabled) root.taskBoxOutlines = "1";
    else delete root.taskBoxOutlines;
    return () => { delete root.taskBoxOutlines; };
  }, [enabled]);
}
