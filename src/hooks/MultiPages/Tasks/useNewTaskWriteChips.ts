import { useMemo } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { useFlag } from "@/hooks/useFlag";
import {
  buildNewTaskWriteChips,
  type NewTaskWriteChip,
} from "@/lib/ai/newTaskWrite";
import { HTPR_7472_TASK_TEMPLATES_FLAG } from "@/lib/flags/keys";
import type { TaskTemplateSummary } from "@/lib/taskTemplatePrefill";

export function useNewTaskWriteChips(
  projectId: number | undefined,
  active: boolean,
): NewTaskWriteChip[] {
  const templatesEnabled = useFlag(HTPR_7472_TASK_TEMPLATES_FLAG);
  const { data } = useQuery({
    queryKey: ["task-templates", projectId, "write-chips"],
    enabled: active && templatesEnabled && projectId !== undefined,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await axios.get<{ templates: TaskTemplateSummary[] }>(
          "/api/task-templates",
          { params: { projectId } },
        )
      ).data.templates,
  });
  return useMemo(() => buildNewTaskWriteChips(data), [data]);
}
