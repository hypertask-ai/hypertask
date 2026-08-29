export const resetUserRoute = "/resetUser";
export const getUsersByEmailsForResetRoute = "/users/getByEmails";

export const GetORUpdateUserAPIRoute = "/users/update";

// ----------------------- Task Status/Create
export const invokeTaskDeleteRoute = "/api/tasks/deleteTask";
export const invokeTaskRecoverRoute = "/api/tasks/recoverTask";
export const archiveUnarchiveTaskRoute = "/api/tasks/(un)archive";
export const createNewTaskGloballyRoute = "/api/tasks/createGlobally";
export const moveTaskToDifferentBoardAPI =
  "/api/tasks/move-task-to-different-board";

// ----------------------- Pages
export const createPageRoute = "/api/pages/create";
export const pageRoute = (id: string) => "/api/pages/" + id;
export const listPagesRoute = "/api/pages/list";
export const searchPagesRoute = "/api/pages/search";
export const pageVersionsRoute = (id: string) =>
  "/api/pages/" + id + "/versions";
export const pageRestoreRoute = (id: string) =>
  "/api/pages/" + id + "/restore";
export const taskDescriptionVersionsRoute = (taskId: string) =>
  "/api/tasks/" + taskId + "/description-versions";
export const taskDescriptionRestoreRoute = (taskId: string) =>
  "/api/tasks/" + taskId + "/description-restore";

// ----------------------- Inbox Split Setting
export const getInboxSplitSettingRoute = "/api/inboxSplitSetting/get";
export const updateInboxSplitSettingRoute = "/api/inboxSplitSetting/update";

// ----------------------- Subtask Linking
export const getOrphanTasksRoute = "/api/tasks/searchOrphans";
export const addParentTaskRoute = "/api/tasks/addParent";
export const removeParentTaskRoute = "/api/tasks/removeParent";

// ----------------------- View Routes
export const switchViewAPIRoute = "/api/projects/views/switch-view";
export const unsavedViewAPIRoute = "/api/projects/views/unsaved-view";
export const resetToDefaultAPIRoute = "/api/projects/views/reset-to-default";
export const updateViewAPIRoute = "/api/projects/views/update-view";
export const deleteRenameViewAPIRoute =
  "/api/projects/views/delete-rename-view";

// ----------------------- Custom Instruction Update
export const UpdateAICustomInstructionRoute = "/ai/project/customInstruction";

// ----------------------- Stripe checkout
export const CHECKOUT_SESSION_API_ENDPOINT = "/api/stripe/session/checkout";

// ----------------------- Share Task Route
export const shareLinkRoute = "/api/share/createShareLink";
export const addUserToTeamFromShareRoute = "api/members/share";
export const getSharedTaskRoute = "/api/share/getSharedTask";

// ----------------------- Star/Pin Task/Comment Route
export const toggleStarPin = "/api/savedContent/toggleSaved";
export const getAllStarsAndPinsRoute = "/api/savedContent/getAll";

//------------------------ Update Profile Profile Picture
export const updateProfilePictureRoute = "/api/users/updateProfilePicture";

export const sendAiChatMessageRoute = "/api/ai/chat/stream";

export const audioTranscriptRoute = "/api/ai/audio-transcript";

export const tiptapForwardSlashRoute = "/api/ai/tiptap-forwardslash";

export const taskWriterRoute = "/api/ai/task-writer";
export const boardMemoryRoute = "/api/ai/project/memory";

/** Next.js App Router: GET user chat sessions (cookie auth). */
export const getAllAiChatSessionsRoute = "ai-chat/all-sessions";
/** Next.js App Router: POST create chat session (cookie auth). */
export const createAiChatSessionNextRoute = "ai-chat/create-session";
export const addMessageToSessionRoute = "ai-chat/add-message";
export const updateAiChatSessionRoute = "ai-chat/update-session";
export const deleteAiChatSessionRoute = "ai-chat/delete-session";
//------------------------- Remove/Add Relation b/w tasks
export const removeRelationFromTaskRoute = "/api/tasks/removeRelation";
export const addRelationsToTaskRoute = "/api/tasks/addRelations";

// export const getSes = (userUUID:string) => "/api/users/updateProfilePicture"+ `userId=${userUUID}`;
export const uploadFilesToRagAPI = "/ai/custom-instructions/upload";
export const deleteFromRagAPI =
  "/ai/custom-instructions/delete-file-by-source";

//------------------------- ONBOARDING AND LOGIN APIS
export const updateUserOnboardingRoute = "/api/users/onboardingStatus/update";
export const createTeamOnboardingStepRoute =
  "/api/users/completeOnboardingStep1";

export const getHyperRoute = "/api/users/getHyper";

//--------------------------- SEARCH COMP
export const searchDocumentsRoute = "/api/search/document";
