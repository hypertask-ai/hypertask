// import { IPriority } from "@/models/model";
import { ILabel } from "@/models/model";
import axios from "axios"



// get all notifications for a user 
export const getAllProjectLabels = async (projectId:number|null|undefined):Promise<ILabel[] | undefined> => {
    if (!projectId) return
        try {
            const getProjectLabels = await axios.get(`/api/labels/getByProject?projectId=${projectId}`)
            // console.log("🚀 ~ getAllProjectLabels ~ getProjectLabels:", getProjectLabels)
            return getProjectLabels.data
            // if (!taskId) return getProjectLabels.data ;
            // else{
            //     const updatedData: any[] = getProjectLabels.data.map((item: any) => {
            //         const hasMatchingTask = item.task.some((task: any) => task.taskId === taskId);
                    
            //         if (hasMatchingTask) {
            //             item.check = true;
            //         }

            //         return item;
            //     });
            //     updatedData.sort((a: { task: { taskId: number; }[]; check?: boolean }, b: { task: { taskId: number; }[]; check?: boolean }) => {
            //         const aTaskId: number = a.task[0]?.taskId || 0;
            //         const bTaskId: number = b.task[0]?.taskId || 0;
                
            //         if (a.check) return -1; // Ensure item with check=true is on top
            //         if (b.check) return 1; // Ensure item with check=true is on top
                
            //         return bTaskId - aTaskId; // Sort based on taskId
            //     });
            //         // Add the check attribute to the appropriate item
                    
            //     console.log("🚀 ~ constupdatedData:any[]=getProjectLabels.data.map ~ updatedData:", updatedData)
            //     return updatedData
            // }
        } catch (error) {
            // Handle the error or return a default value
            console.error("Error getting Assignees and Members:", error);
            throw error; // You can also return a default value or handle the error in a different way
        }
  
}




