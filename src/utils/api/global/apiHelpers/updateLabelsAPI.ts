import { logger as htLogger } from "#logger";
import axios from "axios"

const route = "/api/labels/updateLabel"

export const deleteLabelAPI = async(labelId:string, projectId: number|undefined, userId: number | undefined)=>{
    try {
        const response = await axios.delete(route+`?labelId=${labelId}&projectId=${projectId}&userId=${userId}`)
        return response.data
    } catch (error) {
        htLogger.info("🚀 ~ deleteLabelAPI ~ error:", error)
        
    }
}

export const updateLabelAPI = async(value:string,labelId:string,ai_prompt?:string)=>{
    try {
        const response = await axios.post(route,{
            value, labelId, ai_prompt
        })
        return response.data
    } catch (error) {
        htLogger.info("🚀 ~ deleteLabelAPI ~ error:", error)
        
    }
}
