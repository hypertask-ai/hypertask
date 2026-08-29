import { ISection } from "@/models/model"
import axios from "axios"



// get all notifications for a user 
export const getAllManageColumnsAPI = async (projectId:number|null|undefined, userId:number) => {
    console.log("🚀 ~ getAllManageColumnsAPI ~ projectId:", projectId)
    if (!projectId) return false
    try {

        const response = await axios.post(`/api/section/getProjectSections`, { userId, projectId})
        return response.data as ISection[]
    } catch (error) {
        console.log("🚀 ~ getAllManageColumnsAPI ~ error:", error)
        
    }
    
}




