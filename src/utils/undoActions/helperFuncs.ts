
import { toggleStarPin } from "@/lib/constants/APIRouteConstants"
import { realtimeEchoHeaders } from "@/lib/realtime/client"
import { ISavedContent, IUser } from "@/models/model"
import clsx, { ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import axios from "axios";
import globalAPIHandlers from "../api/global";

export async function undoTaskDelete(data: any) {
  await globalAPIHandlers.archiveTask(data.id, "Normal")
}

export function undoTaskUpdate(data: any) {
}

export function undoTaskCreate(data: any) {
}


export async function UndoInboxArchive(data:any){
  console.log("🚀 ~ UndoInboxArchive ~ data:", data)
  if (data.isInboxZeroOperation) {
    return fetch('/api/notifications/inbox-zero/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...realtimeEchoHeaders() },
      body: JSON.stringify({ notificationIds: data.notificationIds })
    });
  } else if (data.isBulkOperation) {
        const { notificationIds } = data;
        if (data.syntheticNotifications?.length) {
          await Promise.all(data.syntheticNotifications.map((notification: { id: string; taskId: number; type: string }) =>
            fetch(`/api/notifications/markAsDone?id=${notification.id}&taskId=${notification.taskId}&userId=${data.currentUser.id}&type=${notification.type}`, { headers: realtimeEchoHeaders() })
          ));
          if (notificationIds.length === 0) return;
        }
        
        const response = await fetch('/api/notifications/(un)archiveBulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...realtimeEchoHeaders() },
            body: JSON.stringify({
                notificationIds,
                status: 'Normal'
            })
        });

        return response;
    } else {
      await fetch(`/api/notifications/markAsDone?id=${data.notification.id}&taskId=${data.notification.taskId}&userId=${data.currentUser.id}&type=${data.notification.type}`, { headers: realtimeEchoHeaders() })

    }

}

export async function UndoStar (data: any) {   
  await axios.post(toggleStarPin, {
    taskId: data.taskId,
    projectId: data.projectId,
    commentId: data.commentId,
    type: data.type,
  });
}

export async function UndoPin (data: any) {   
  await axios.post(toggleStarPin, {
    taskId: data.taskId,
    projectId: data.projectId,
    commentId: data.commentId,
    type: data.type,
  });
}

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "meta", "dense", "content", "emphasis", "subheading", "heading", "display"] }],
      "border-w": [{ border: ["thin"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const changeTheme = (theme: string) => {
  document.querySelector("html")?.setAttribute("data-theme", theme);
};

interface IReturnIsValidUser{
  isValid: boolean;
  user: IUser|null;
}
export const isValidUser = (cookie:any):IReturnIsValidUser => {
  try {
    if (!cookie) throw""
    const parsedCookie = JSON.parse(cookie);
    if( parsedCookie.id && parsedCookie.displayName && parsedCookie.email){
      return {
        isValid:true,
        user:parsedCookie
      }
    }
    else throw ""
  } catch (error) {
    return {
      isValid:false,
      user:null
    }
  }
};
