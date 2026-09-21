import axios from "axios"
import { getTaskDetailMeta, hasSessionCookie } from "./getTaskDetailMeta";

// Shares one request with priority/estimate/followers instead of hitting
// /api/labels/getByTask on its own (HTPR-3708). Logged out (the public /share
// page) it stays on the old route, which is how anonymous visitors keep seeing
// a task's labels. Same return shape either way.
export const getAllTaskLabels = async (taskId:number|null):Promise<any | undefined> => {
    if (!taskId) return
        try {
            if (!hasSessionCookie()) {
                const legacy = await axios.get(`/api/labels/getByTask?taskId=${taskId}`)
                return legacy.data ?? [];
            }
            const meta = await getTaskDetailMeta(taskId)
            return meta.labels ?? [];
        } catch (error) {
            console.error("Error getting task labels:", error);
            throw error;
        }
}
