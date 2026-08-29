import {
  getAllStarsAndPinsRoute,
  toggleStarPin,
} from "@/lib/constants/APIRouteConstants";
import { ISavedContent } from "@/models/model";
import { currentUserAtom } from "@/store";
import { ViewVisibility } from "@prisma/client";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRecoilState } from "@/lib/state";
import useHypertasksNavigate from "../MultiPages/Route/useHypertasksNavigate";
import toast from "react-hot-toast";
import { useUndoContext } from "../General/useUndo";
import globalConstants from "@/lib/constants";

export const useStarAndPin = () => {
  const [currentUser, _] = useRecoilState(currentUserAtom);
  const { navigate } = useHypertasksNavigate();
  const queryClient = useQueryClient();
  const { undoAction, performActionAndStoreUndoData } = useUndoContext();

  //----------------------------Fetch functions
  const starTask = async (
    taskId: number,
    projectId: number,
    alwaysRemove: boolean = false
  ) => {
    const response = await axios.post(toggleStarPin, {
      taskId,
      projectId,
      type: "Private",
      alwaysRemove,
    });

    return response;
  };

  const pinComment = async (
    taskId: number,
    projectId: number,
    commentId: string,
    type: ViewVisibility = "Private"
  ) => {
    const response = await axios.post(toggleStarPin, {
      taskId,
      projectId,
      commentId,
      type,
    });
    console.log("🚀 ~ useStarAndPin ~ response:", response);
    return response;
  };

  const getAllStarred = async () => {
    try {
      const response = await axios.post(getAllStarsAndPinsRoute);
      if (response.status) return response.data;
    } catch (error: any) {
      console.log("🚀 ~ getAllStarred ~ error:", error);
    }
  };

  const getAllPinned = async () => {
    try {
      const response = await axios.post(getAllStarsAndPinsRoute, {
        pinned: true,
      });
      if (response.status) return response.data;
    } catch (error: any) {
      console.log("🚀 ~ getAllStarred ~ error:", error);
    }
  };

  /**
   *Function to remove object from cache.
   *Type var determines the type of starred object to remove
   *Stores previous data for performing undo
   *
   * @param {ISavedContent} contentToRemove
   * @param {("Comment" | "Task")} type
   * @return {*}
   */
  const removeFromStarredContentQuery = async (
    contentToRemove: ISavedContent,
    type: "Comment" | "Task"
  ) => {
    performActionAndStoreUndoData(
      contentToRemove,
      `Undo star ${type.toLowerCase()}`,
      undoStarredHandler
    );

    queryClient.invalidateQueries({
      queryKey: ["Saved starred for [userId]:", currentUser.id],
    });
  };
  /**
   *Function to add object to cache
   *Type var determines the type of starred object to add
   *
   * @param {ISavedContent} contentToAdd
   * @param {("Comment" | "Task")} type
   * @return {*}
   */
  const addToStarredContentQuery = async (
    contentToAdd: ISavedContent,
    type: "Comment" | "Task"
  ) =>
    queryClient.invalidateQueries({
      queryKey: ["Saved starred for [userId]:", currentUser.id],
    });
  /**
   *Undohandler for unstarring task/comment
   *
   * @param {ISavedContent} data
   * @param {string} toastId
   */
  const undoStarredHandler = async (data: ISavedContent, toastId: string) => {
    await undoAction("UNDO_STAR", data);
    queryClient.refetchQueries({
      queryKey: ["Saved starred for [userId]:", currentUser.id],
    });
    navigate("Refresh");
    toast.dismiss(toastId); // Dismiss the toast here
  };
  /**
   *Function to remove object from cache.
   *Type var determines the type of starred object to remove
   *Stores previous data for performing undo
   *
   * @param {ISavedContent} contentToRemove
   * @param {("Personal" | "Team")} type
   * @return {*}
   */
  const removeFromPinnedContentQuery = async (
    contentToRemove: ISavedContent,
    type: "Personal" | "Team"
  ) => {
    performActionAndStoreUndoData(
      contentToRemove,
      "Undo pin comment",
      undoPinnedHandler
    );
    const savedData: any = await queryClient.getQueryData([
      "Saved pinned for [userId]:",
      currentUser.id,
    ]);
    if (!savedData) return;
    let updatedContent;
    if (type === "Personal") {
      updatedContent = {
        ...savedData,
        personalPins: savedData.personalPins.filter(
          (item: ISavedContent) => item.id !== contentToRemove.id
        ),
      };
    } else {
      updatedContent = {
        ...savedData,
        teamPins: savedData.teamPins.filter(
          (item: ISavedContent) => item.id !== contentToRemove.id
        ),
      };
    }
    queryClient.setQueryData(
      ["Saved pinned for [userId]:", currentUser.id],
      updatedContent
    );
    queryClient.refetchQueries({
      queryKey: [globalConstants.CommentsTQPrefixKey, contentToRemove.taskId],
    });
  };
  /**
   *Function to add object to cache
   *Type var determines the type of starred object to add
   *
   * @param {ISavedContent} contentToAdd
   * @param {("Personal" | "Team")} type
   * @return {*}
   */
  const addToPinnedContentQuery = async (
    contentToAdd: ISavedContent,
    type: "Personal" | "Team"
  ) => {
    const savedData: any = await queryClient.getQueryData([
      "Saved starred for [userId]:",
      currentUser.id,
    ]);
    if (!savedData) return;
    let updatedContent;
    if (type === "Personal") {
      updatedContent = {
        ...savedData,
        personalPins: [...savedData.personalPins, contentToAdd],
      };
    } else {
      updatedContent = {
        ...savedData,
        teamPins: [...savedData.teamPins, contentToAdd],
      };
    }
    queryClient.setQueryData(
      ["Saved pinned for [userId]:", currentUser.id],
      updatedContent
    );
    queryClient.refetchQueries({
      queryKey: [globalConstants.CommentsTQPrefixKey, contentToAdd.taskId],
    });
  };
  /**
   *Undohandler for unpinning public comment
   *
   * @param {ISavedContent} data
   * @param {string} toastId
   */
  const undoPinnedHandler = async (data: ISavedContent, toastId: string) => {
    await undoAction("UNDO_PIN", data);
    queryClient.refetchQueries({
      queryKey: ["Saved pinned for [userId]:", currentUser.id],
    });
    queryClient.refetchQueries({
      queryKey: [globalConstants.CommentsTQPrefixKey, data.taskId],
    });

    navigate("Refresh");
    toast.dismiss(toastId); // Dismiss the toast here
  };

  return {
    starTask,
    pinComment,
    getAllStarred,
    getAllPinned,
    removeFromStarredContentQuery,
    addToStarredContentQuery,
    removeFromPinnedContentQuery,
    addToPinnedContentQuery,
  };
};
