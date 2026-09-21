import axios from "axios"
import { getTaskDetailMeta, hasSessionCookie } from "./getTaskDetailMeta";

// Shares one request with priority/labels/followers instead of hitting
// /api/estimate/getByTask on its own (HTPR-3708). Logged out (the public /share
// page) it stays on the old route. Same return shape either way.
export const getEstimateForTask = async (taskId:number|null):Promise<any | undefined> => {
    if (!taskId) return
        try {
            if (!hasSessionCookie()) {
                const legacy = await axios.get(`/api/estimate/getByTask?taskId=${taskId}`)
                return legacy.data;
            }
            const meta = await getTaskDetailMeta(taskId)
            return meta.estimate;
        } catch (error) {
            console.error("Error getting task estimate:", error);
            throw error;
        }
}
