import { useMemo } from "react";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import useKanbanViews from "../Homepage/Views/useKanbanViews";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import { useGetSubTaskSetting } from "../MultiPages/useGetSubTaskSetting";
import globalConstants from "@/lib/constants";
import { useQueryClient } from "@tanstack/react-query";

const useSubTask = () => {
  const [currentProject, __] = useRecoilState(currentProjectAtom);
  const [currentUser, _] = useRecoilState(currentUserAtom);
  const { saveSubtaskSettingAPI } = useKanbanViews(currentProject);
  const queryClient = useQueryClient();

  const { data: setting } = useGetSubTaskSetting(
    currentUser.id,
    currentProject
  );

  const currentSetting: TBoardSubtaskSetting = useMemo(
    () => setting,
    [setting]
  );

  const updateCache = async (newData: TBoardSubtaskSetting) => {
    const queryKey = [
      globalConstants.GetCurrentSubtaskSettingKey,
      currentProject?.id,
      currentUser.id,
    ];

    queryClient.setQueryData(queryKey, newData);
    if (currentProject) {
      saveSubtaskSettingAPI(currentProject, newData);
    }
  };

  const updateSubTaskSetting = async (setting: TBoardSubtaskSetting) => {
    try {
      updateCache(setting);
    } catch (error) {
      console.log("🚀 ~ updateSubTaskSetting ~ error:", error);
    }
  };

  return { currentSetting, updateSubTaskSetting };
};

export default useSubTask;
