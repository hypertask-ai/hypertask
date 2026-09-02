import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { IAgent, ILabel, IProject, ITask, IUser } from "../model";
import { IEstimateConstants, IPrioritiesConstants } from "@/lib/constants/constants";
import type { DictationCoordinator } from "@/lib/dictationCoordinator";

export interface IForm{
    "title":string;
    "description":string;
    "assignees":(IUser|IAgent)[];
    "attachments":any[];
    "status"?:ISectionPayload,
    "priority"?:IPrioritiesConstants|undefined;
    "estimate"?:IEstimateConstants;
    "dueDate"?:Date;
    "startDate"?:Date;
    "tags"?:ILabel[];
    "currentProject"?:IProject;
}

export interface IParentTask{
    title?: string;
    id?: number;
    ticketNumber?:string;
}
export type TFormKey = "title"| "description" |"assignees"|"attachments" | "status" | "priority" | "estimate" |"dueDate" | "startDate" | "tags" | "currentProject"

export type TEditModeCTModal = "title" | "assignees" | "Description" |"Description-ai"| null 
export type TCurrentFocusedElement = "Title" | "Assignees" |"Save" |"Description"|"title-input"
export interface ITaskGlobalStates{
    handleChange: (key: TFormKey, value: any) => void;
    appendDictationToTitle: (transcript: string) => void;
    dictationCoordinator: DictationCoordinator;
    formValues: IForm;
    editMode: TEditModeCTModal;
    setEditMode: Dispatch<SetStateAction<TEditModeCTModal>>;
    showAssignModal: boolean;
    setShowAssignModal: Dispatch<SetStateAction<boolean>>;
    currentFocusedElement: TCurrentFocusedElement;
    setCurrentFocusedElement: Dispatch<SetStateAction<TCurrentFocusedElement>>;
    selectedProject: IProject | undefined;
    setSelectedProject:     Dispatch<SetStateAction<IProject | undefined>>;
    focusOn: (el: TCurrentFocusedElement) => void;
    uploadInProgress: boolean;
    setUploadInProgress: Dispatch<SetStateAction<boolean>>;
    currentTask: ITask | undefined;
    setCurrentTask: Dispatch<SetStateAction<ITask | undefined>>;
    closeHandler: (save?:boolean) => void;
    CreateTaskAndDescription: (descriptionOverride?: string, titleOverride?: string) => Promise<string | undefined>;
    applyTaskWriterTitle: (title: string) => void;
    enableAutoTitleGeneration: () => void;
    scheduleTitleGeneration: (description: string) => void;
    generateTitleFromDescription: (
      description: string,
    ) => Promise<string | null>;
    shouldGenerateTitleForSave: (title: string, description: string) => boolean;
    getCurrentTitle: () => string;
    saveEpochRef: MutableRefObject<number>;
    isGeneratingTitle: boolean;
    titleGenerationError: string | null;
    resetFormValues: () => void;
    showConfirmationModal: boolean;
    setShowConfirmationModal:Dispatch<SetStateAction<boolean>>;
    onConfirmDiscard: () => void;
    onCancelDiscard: () => void;
    userInput: string;
    handleSetUserInput: (input: string) => void;
    parentTaskInfo?: IParentTask;
    allProjects: IProject[];
    handleProjectChange: (project: IProject) => void;
    toggleRecording: (val: boolean) => void;
    isRecording: boolean;
    hasUnsavedChanges: () => boolean;
    taskWriterFilled: boolean;
    setTaskWriterFilled: Dispatch<SetStateAction<boolean>>;
}


interface ISectionPayload extends TSectionPayload{
    ranking?:string
}

//TODO: this needs to be done better.
export type TSectionPayload= {
    sectionId: number;
    sectionTitle:string;
    priority?:IPrioritiesConstants;
    position: "top"| "bottom";
    parentTask?: IParentTask;
    prefilledTitle?:string;
    prefilledDescription?:string;
    prefilledAttachments?:any[];
    prefilledDueDate?:Date;
    projectId?: number;
    createTaskFromComment?: {
        task: ITask;
        commentIndex: number;
    } 
  }

export type TDefaultEditFocus={
    defaultEditMode?:TEditModeCTModal;
    defaultFocus?:TCurrentFocusedElement;
    /**
     * Seeds the AI task writer's composer for this opening only (guest demo).
     * Not sent: the user still presses send.
     */
    aiPrompt?:string;
}
export type TSendBackButtonParam = "Save" | "SaveAndClose" | "SaveAndNew"
export type TSendBackAttachmentButton = (
  sendBackType?: TSendBackButtonParam,
) => void | boolean | Promise<unknown>
