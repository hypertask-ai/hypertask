import globalConstants from "@/lib/constants";
import { IProject } from "@/models/model";
import { currentProjectAtom } from "@/store";
import { getActiveSubtaskSettingFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { useQuery } from "@tanstack/react-query";
import { useRecoilState } from "@/lib/state";

export const useGetSubTaskSetting = (
  userId: number,
  project?: IProject | null | undefined,
  initialData?: any
) => {
  const [currentProject, _] = useRecoilState(currentProjectAtom);

  return useQuery({
    queryKey: [
      globalConstants.GetCurrentSubtaskSettingKey,
      project?.id,
      userId,
    ],
    queryFn: () => {
      if (currentProject)
        return getActiveSubtaskSettingFromProject(currentProject);
      else return [];
    },
    initialData: initialData ?? [],
  });
};
