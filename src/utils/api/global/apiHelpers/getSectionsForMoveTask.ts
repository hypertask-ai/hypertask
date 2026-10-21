import { ISection } from "@/models/model";
import axios from "axios";

export const getSectionsForMoveTask = async (projectId:number) => {
    try {
        const response = await axios.post(`/api/section/getProjectSections`, {
            projectId:projectId
          });
          let responseArray:ISection[] = response.data;
          return responseArray;
        } catch (error) {
        console.error("Error getting Assignees and Members:", error);
        throw error;
    }

}