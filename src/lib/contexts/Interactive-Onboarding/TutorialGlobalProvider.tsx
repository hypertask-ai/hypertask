"use client";
import { ICommandList } from "@/components/Modals/commands/HTC/HTCTypes";
import { DisplayDate } from "@/components/Modals/RemindMe/RemindMeComponent";
import { useTutorial } from "@/hooks/General/useTutorial";
import {
  IBoard,
  IBoardHeader,
  INotification,
  ISplitTitle,
  ITutorialAtom,
  ITutorialScene,
  TTutorialPage,
} from "@/models/InteractiveOnboarding/model";
import type { Editor } from "@tiptap/react";
import React, { createContext, useContext, ReactNode, RefObject } from "react";

const TutorialContext = createContext<ITutorialProps | undefined>(undefined);
interface TutorialProviderProps {
  children: ReactNode;
}

interface ITutorialProps {
  activeBoard: number;
  activeColumn: number;
  activeHint: number;
  activeNotification: number;
  activeModalIndex: number;
  activeScene: ITutorialAtom;
  activeTask: number;
  activeTaskPage: number;
  addColumnInput: string;
  board: IBoard;
  commentInput: string;
  currentScene: ITutorialScene;
  commentEditor: Editor | null;
  descriptionEditor: Editor | null;
  filteredOptions: (DisplayDate | undefined)[];
  filteredSideBarOptions: IBoardHeader[];
  filterMoveColumnsOptions: string[];
  handleAddColumnInput: (e: any) => void;
  handleCommentInput: (content: string) => undefined;
  handleMoveTaskInput: (e: any) => void;
  handleRemindMeModalInput: (e: any) => void;
  handleSideBarInput: (e: any) => void;
  handleCommandCallback: (e: ICommandList) => void;
  handlePriorityInput: (e: any) => void;
  priorityModalInput: string;
  moveTaskModalInput: string;
  notifications: INotification[];
  remindMeModalInput: string;
  sceneState: {
    [x: string]: any;
  };
  shake: boolean;
  sideBarInput: string;
  splitTitles: ISplitTitle[];
  updateScene: (
    page: TTutorialPage,
    push: boolean,
    phase: number | undefined
  ) => void;
  description: string;
  AITaskWriterHandler: (
    s: string,
    proceed?: boolean,
    newTitle?: string
  ) => void;
  title: string;
  filterPriorityOptions: any[];
  exitTutorial: () => void;
  currentUser: any;
  showExit: boolean;
  assigneeInput: string;
  filteredAssignees: {
    pfp: string;
    name: string;
  }[];
  handleAssigneeInput: (e: any) => void;
  isFunnelUserAndNotCompleted:boolean;
}

export const TutorialProvider: React.FC<TutorialProviderProps> = ({
  children,
}) => {
  const exportThis: ITutorialProps = useTutorial();
  return (
    <TutorialContext.Provider
      value={{
        ...exportThis,
      }}
    >
      {children}
    </TutorialContext.Provider>
  );
};

export const useTutorialContext = () => {
  const context = useContext(TutorialContext);

  if (!context) {
    throw new Error("useTutorial must be used within a TutorialProvider");
  }

  return context;
};
