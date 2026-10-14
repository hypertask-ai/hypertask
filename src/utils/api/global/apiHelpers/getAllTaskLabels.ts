import axios from "axios"
import { getTaskDetailMeta, hasSessionCookie } from "./getTaskDetailMeta";

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
