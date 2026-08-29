import { fetchUserPreference } from "@/hooks/General/useGetUserPreferences";
import { shareLinkRoute } from "@/lib/constants/APIRouteConstants";
import { IAgent, IAssignees, IComment, IUser } from "@/models/model";
import { TaskShareType } from "@prisma/client";
import { getTaskDetailMeta, hasSessionCookie } from "@/utils/api/global/apiHelpers/getTaskDetailMeta";
import axios, { CancelTokenSource } from "axios";
import { uploadFilesViaApi } from "@/lib/storage/uploadViaApi";

export const getDraftsHelper= async(taskId:number, userId:number )=>{
  try {
    const requestBody=  {
      taskId:taskId,
      userId:userId,
    }
    const response = await axios.post("/api/drafts/getDrafts",requestBody)
    if (response.status===200)  return response.data
    
  } catch (error) {
    console.log("🚀 ~ updateDraft ~ error:", error)
    
  }
}

// Module-level variable to persist cancel token across function calls
let cancelTokenSource: CancelTokenSource | null = null;

/** Cancel any in-flight draft autosave (e.g. before publishing description). */
export const cancelPendingDraftUpdates = () => {
  if (cancelTokenSource) {
    cancelTokenSource.cancel("Canceled before description save");
    cancelTokenSource = null;
  }
};

export const updateDraftHelper = async (projectId:number, taskId: number, userId: number, type: any,content:string|undefined, draftId?: number) => {
 try {
    const requestBody = {
      taskId: taskId,
      draftId: draftId,
      userId: userId,
      type: type,
      content:content,
      projectId
    };
    // console.log("🚀 ~ updateDraftHelper ~ requestBody:", requestBody)

    // Cancel the previous request if it exists
    if (cancelTokenSource) {
      cancelTokenSource.cancel('Operation canceled due to new request.');
    }

    // Create a new CancelToken
    cancelTokenSource = axios.CancelToken.source();

    const response = await axios.post("/api/drafts/updateDraft", requestBody, {
      cancelToken: cancelTokenSource.token,
    });

    // console.log("🚀 ~ updateDraft ~ response:", response);
    if (response.status === 200) return response;
 } catch (error) {
    if (axios.isCancel(error)) {
      console.log('Request canceled', error.message);
      // Don't throw - cancellation is expected behavior
      return;
    } else {
      console.log("🚀 ~ updateDraft ~ error:", error);
      throw error; // Re-throw non-cancellation errors
    }
 }
};


  // Preferences barely change but fetchCommentsHelper runs per comments
  // (pre)fetch — this raw call bypassed the React Query cache and fired one
  // /api/users/preferences per inbox keystroke (HTPR-3998). 5 min TTL memo,
  // matching useGetUserPreferences' staleTime.
  let prefMemo: { value: any; at: number } | null = null;
  const fetchUserPreferenceMemo = async () => {
    if (prefMemo && Date.now() - prefMemo.at < 5 * 60 * 1000) return prefMemo.value;
    const value = await fetchUserPreference();
    prefMemo = { value, at: Date.now() };
    return value;
  };

  // ---------------------- FETCH COMMENTS ---------------
  export const fetchCommentsHelper = async (taskId:number, userId:number) => {
    const response = await fetch(`/api/comments/getByTask?taskId=${taskId}`);
    const prefResponse = await fetchUserPreferenceMemo()
    const stack = prefResponse?.commentsStacked || false
    const data = await response.json()
    const comments = Array.isArray(data) ? data : data?.comments ?? [];
    const lastReadAt = Array.isArray(data) ? null : data?.lastReadAt ?? null;
    const initialMap: any = {};

    comments.slice(0, -1).map((item: IComment, index: number) => {
      let pinned : boolean | undefined = undefined;
      if(item.savedContent && item.savedContent.length>0){
        pinned =  item.savedContent.find(
          (sc) => sc.type === "Public"
        ) ? false
        : true;
      }
      initialMap[index] = pinned ?? item.seen?.includes(userId)? stack: false;
  })
  return {comments,stacked:initialMap,lastReadAt}
  
} 

export const getScrollSetting = async () => {
  try {
    const response = await axios.get(
      "/api/users/scrollSettings/getScrollSetting"
    );
    if (response.status == 200) {
      console.log(
        "🚀 ~ getScrollSetting",
        response?.data?.res[0]?.scrollSetting
      );
      return { setting: response?.data?.res[0]?.scrollSetting };
    } else {
      console.log("error occured");
      return { stack: undefined };
    }
  } catch (error) {
    console.log(error);
  }
};

export interface commentBody {
   text: string;
    creatorId: number;
    commentId: string | undefined;
    taskId: number;
}

export const fetchAssignedUsers = async (taskId: number) => {
  const response = await fetch(`/api/assignees/getAll?taskId=${taskId}`);

  if (response.status === 200) {
    const data = await response.json();
    if (data) {
      let assignees: (IUser | IAgent)[] = [];
      assignees = data.map((item: IAssignees) => {
        if (item.agent !== null) return item.agent;
        if (item.user !== null) return item.user;
      });
      return assignees;
    }
  }
  return [];
};


// ========================== get all followers
export const getAllFollowers = async(taskId:number) => {

  try {
    // Shares one request with priority/estimate/labels instead of hitting
    // /api/follower/getFollower on its own (HTPR-3708). The creator-filtering
    // rule moved with it, so the returned list is unchanged. Logged out (the
    // public /share page) it stays on the old route.
    if (!hasSessionCookie()) {
      const legacy = await axios.post("/api/follower/getFollower", { taskId });
      return legacy.data;
    }
    const meta = await getTaskDetailMeta(taskId);
    return meta.followers;
  } catch (error) {
  }
}



// ========================== UPDATE COMMENTS
export const updateComment = async(updatedComment:commentBody,resultUrls:any[], commentId?:string) => {

  console.log("🚀 ~ file: index.ts:48 ~ updateComment ~ resultUrls:", resultUrls)
  const response = await axios.put("/api/comments/updateComment", updatedComment )
  await axios.put("/api/urls/addIntoTask", { urlsToAdd: resultUrls, commentId: commentId })

  return response

}

// ========================== UPDATE TASK
export const updateTask = async(updatedTaskBody:any, otherPayload?:any, mode?:string)=>{
  const response = await axios.put('/api/tasks/single', {newTask:updatedTaskBody})
  
  if (otherPayload && mode==="SaveDescription"){
    // save urls from the description
    axios.put(`/api/urls/addIntoTaskDesc`,otherPayload )
  }
  return response
}

// --------------------- CONVERTING BASE64s TO FILES -----------------
export async function base64ToFile(
  base64String: string,
  filename: string
): Promise<string> {
  const fileName = Date.now();
  const [meta, base64Payload] = base64String.split(",");
  const mimeMatch = meta?.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(base64Payload ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const file = new File([bytes], `${fileName}-${filename}`, { type: mimeType });
  const urls = await uploadFilesViaApi([file]);
  return urls[0];
}

export async function uploadDocumentsToS3(
  fileItems: File[],
  _taskId: number
): Promise<string[]> {
  return uploadFilesViaApi(fileItems);
}


export async function setDueDateApiHandler(
  dueDate:Date|undefined,
  taskId:number
){
  try {
    const result = await axios.post("/api/tasks/setDueDate", {
      taskId,
      dueDate
    });
    return (result.data);
  } catch (error) {
  console.log("🚀 ~ error:", error)
  }
}

// HTPR-4884: planned start date. Undefined clears it.
export async function setStartDateApiHandler(
  startDate: Date | undefined,
  taskId: number
) {
  try {
    const result = await axios.post("/api/tasks/setStartDate", {
      taskId,
      startDate: startDate ?? null,
    });
    return result.data;
  } catch (error) {
    console.log("🚀 ~ setStartDateApiHandler ~ error:", error);
  }
}

// HTPR-4885: repeat rule. Null stops the task repeating.
export async function setRecurrenceApiHandler(
  recurrence: string | null,
  taskId: number
) {
  try {
    const result = await axios.post("/api/tasks/setRecurrence", {
      taskId,
      recurrence,
    });
    return result.data;
  } catch (error) {
    console.log("🚀 ~ setRecurrenceApiHandler ~ error:", error);
  }
}


interface IAssignToMultipleApiHandler{
  assignerId:number;
  taskId:number;
  userIds:number[];
  currentUser:IUser
}
export const assignToMultipleApiHandler = async({assignerId, taskId, userIds, currentUser}:IAssignToMultipleApiHandler)=>{
  try {
    const response = await axios.post("/api/assignees/assign", {
      userId: currentUser.id,
      taskId,
      assigner: currentUser,
      mode:"multiple",
      userIds
    });
    if (response.status===200) return response.data
  } catch (error) {
    console.log("🚀 ~ assignToMultipleApiHandler ~ error:", error)
    
  }
}

export const getTaskShareLink = async (
  taskId: number,
  projectId: number,
  userId: number
) => {
  const response = await axios.post(shareLinkRoute, {
    taskId,
    projectId,
    userId,
  });
  if (response.status === 200) return response.data.data;
  else return undefined;
};

export const updateTaskShareLink = async (
  shareId: string,
  type: TaskShareType
) => {
  const response = await axios.put(shareLinkRoute, {
    shareId,
    newType: type,
  });
  if (response.status === 200) return response.data.data;
  else return undefined;
};
