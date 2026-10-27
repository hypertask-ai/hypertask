import globalConstants from "@/lib/constants"
import axios from "axios"

const archiveTask = async(taskId:number, status:string, column?: { projectId: number; sectionId: number })=>{
    const archivedResponse = await axios.post(globalConstants.archiveUnarchiveTaskRoute, {taskId, status, ...(column ? { column } : {})})
    console.log("🚀 ~ archiveTask ~ archivedResponse:", archivedResponse)
}
export default archiveTask