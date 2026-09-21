
import globalConstants from "@/lib/constants";
import { IProject } from "@/models/model";
import { currentProjectAtom } from "@/store";
import globalAPIHandlers from "@/utils/api/global";
import { getActiveColumnsViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { useQuery } from "@tanstack/react-query";
import { useRecoilState } from "@/lib/state";



export const useGetAllManageColumns = (userId:number,project?:IProject|null|undefined, initialData?:any) => {
    const [currentProject, _] = useRecoilState(currentProjectAtom)

    return useQuery({
        queryKey:[globalConstants.GetAllManageColumnsPrefixKey, project?.id, userId], 
        // queryFn:() => globalAPIHandlers.getAllManageColumnsAPI(projectId, userId),
        queryFn:()=>{
            console.log("🚀 ~ useGetAllManageColumns ~ currentProject:", currentProject)
            if (currentProject) return getActiveColumnsViewFromProject(currentProject)
            else return []
        },
        initialData:initialData??[]

})
}
