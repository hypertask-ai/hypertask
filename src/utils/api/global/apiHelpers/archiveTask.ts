import { logger as htLogger } from "#logger";
import globalConstants from "@/lib/constants"
import axios from "axios"

const archiveTask = async(taskId:number, status:string)=>{
    // this api unarchives or archives a task.
    const archivedResponse = await axios.post(globalConstants.archiveUnarchiveTaskRoute, {taskId, status})
    htLogger.info("🚀 ~ archiveTask ~ archivedResponse:", archivedResponse)
}
export default archiveTask