import { IPriority } from "@/models/model";
import axios from "axios"
import { getTaskDetailMeta, hasSessionCookie } from "./getTaskDetailMeta";

export const getPriorityForTask = async (taskId:number|null):Promise<IPriority | undefined> => {
    if (!taskId) return
        try {
            if (!hasSessionCookie()) {
                const legacy = await axios.get(`/api/priority/getByTask?taskId=${taskId}`)
                return legacy.data as IPriority;
            }
            const meta = await getTaskDetailMeta(taskId)
            return meta.priority as IPriority;
        } catch (error) {
            console.error("Error getting task priority:", error);
            throw error;
        }
}
