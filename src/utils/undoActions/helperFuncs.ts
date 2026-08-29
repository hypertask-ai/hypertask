// import { performTaskDelete, performTaskUpdate, performTaskCreate } from '../utils/api';

import { toggleStarPin } from "@/lib/constants/APIRouteConstants"
import { realtimeEchoHeaders } from "@/lib/realtime/client"
import { ISavedContent, IUser } from "@/models/model"
import clsx, { ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import axios from "axios";
import globalAPIHandlers from "../api/global";

export async function undoTaskDelete(data: any) {
  // Call the necessary API function to undo task deletion
  // performTaskCreate(data);
  // here we weill run the api to update the task again
  await globalAPIHandlers.archiveTask(data.id, "Normal")
}

export function undoTaskUpdate(data: any) {
  // Call the necessary API function to undo task update
  // performTaskUpdate(data);
}

export function undoTaskCreate(data: any) {
  // Call the necessary API function to undo task creation
  // performTaskDelete(data);
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
        // Handle bulk undo
        const { notificationIds } = data;
        
        const response = await fetch('/api/notifications/(un)archiveBulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...realtimeEchoHeaders() },
            body: JSON.stringify({
                notificationIds,
                status: 'Normal' // or whatever status indicates unarchived
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


// (default, input classname)

/**
 * merges two classnames
 * (defaultClassName, incoming className)
 * @export
 * @param {...ClassValue[]} inputs
 * @return {*} 
 */
// tailwind-merge can't type custom tokens: it read text-meta (a fontSize token) and
// text-icon-dark-gray (a color) as the same group and dropped one. Declare our
// fontSize + borderWidth tokens so cn() never discards them against color classes.
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
