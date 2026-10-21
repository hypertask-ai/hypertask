import { ILabel } from "@/models/model";
import axios from "axios"

export const getAllProjectLabels = async (projectId:number|null|undefined):Promise<ILabel[] | undefined> => {
    if (!projectId) return
        try {
            const getProjectLabels = await axios.get(`/api/labels/getByProject?projectId=${projectId}`)
            return getProjectLabels.data
        } catch (error) {
            console.error("Error getting Assignees and Members:", error);
            throw error;
        }
  
}




