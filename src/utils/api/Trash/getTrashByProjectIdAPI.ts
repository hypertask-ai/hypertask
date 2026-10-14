import { ISection } from "@/models/model";
import axios from "axios"

export const getTrashByProjectIdAPI = async (projectId:number) => {
        try {
            const projectWithTrash = await axios.post(`/api/trash/getTrashByProjectId?projectId=${projectId}`)
            return projectWithTrash.data;
        } catch (error) {
            console.error("Error getting Assignees and Members:", error);
            throw error;
        }
  
}




