import archiveTask from "./apiHelpers/archiveTask";
import { archiveTaskNotification } from "./apiHelpers/archiveTaskNotificationsAPI";
import { deleteTaskAPI } from "./apiHelpers/deleteTask";
import { getAllFavorites } from "./apiHelpers/getAllFavorites";
import { getAllManageColumnsAPI } from "./apiHelpers/getAllManageColumnsAPI";
import { getMembersOwnersForAssignees } from "./apiHelpers/getAllMembersForAssign";
import { getAllProjectLabels } from "./apiHelpers/getAllProjectLabels";
import { getAllProjectsMinimal, getAllTeamMembers } from "./apiHelpers/getAllProjectsMinimal";
import { getAllReminders } from "./apiHelpers/getAllReminders";
import { getAllTaskLabels } from "./apiHelpers/getAllTaskLabels";
import { getEstimateForTask } from "./apiHelpers/getEstimateForTask";
import { getPriorityForTask } from "./apiHelpers/getPriorityForTask";
import { getSectionsForMoveTask } from "./apiHelpers/getSectionsForMoveTask";
import moveTaskHandler from "./apiHelpers/moveTaskHandler";
import { updateLabelAPI, deleteLabelAPI } from "./apiHelpers/updateLabelsAPI";


const globalAPIHandlers = {
    archiveTaskNotification,
    getSectionsForMoveTask,
    getPriorityForTask,
    getAllProjectsMinimal,
    getAllTeamMembers,
    getMembersOwnersForAssignees,
    getAllFavorites,
    getEstimateForTask,
    getAllProjectLabels,
    getAllTaskLabels,
    getAllReminders,
    archiveTask,
    moveTaskHandler,
    deleteTaskAPI,
    getAllManageColumnsAPI,updateLabelAPI, deleteLabelAPI


}

export default globalAPIHandlers;