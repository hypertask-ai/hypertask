import { ISection } from "@/models/model";
import axios from "axios";

// get all notifications for a user 
export const getSectionsForMoveTask = async (projectId:number) => {
    try {
        const response = await axios.post(`/api/section/getProjectSections`, {
            projectId:projectId
          });
          let responseArray:ISection[] = response.data;
          return responseArray;
        } catch (error) {
        // Handle the error or return a default value
        console.error("Error getting Assignees and Members:", error);
        throw error; // You can also return a default value or handle the error in a different way
    }

}