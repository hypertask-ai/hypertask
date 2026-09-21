import { ISection } from "@/models/model";
import axios from "axios"



// get all notifications for a user 
export const getTrashByProjectIdAPI = async (projectId:number) => {
        try {
            const projectWithTrash = await axios.post(`/api/trash/getTrashByProjectId?projectId=${projectId}`)
            return projectWithTrash.data;
        } catch (error) {
            // Handle the error or return a default value
            console.error("Error getting Assignees and Members:", error);
            throw error; // You can also return a default value or handle the error in a different way
        }
  
}




