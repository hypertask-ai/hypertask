import { IPriority } from "@/models/model";
import axios from "axios"
import { getTaskDetailMeta, hasSessionCookie } from "./getTaskDetailMeta";

// Shares one request with estimate/labels/followers instead of hitting
// /api/priority/getByTask on its own (HTPR-3708). Logged out (the public /share
// page) it stays on the old route. Same return shape either way.
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
