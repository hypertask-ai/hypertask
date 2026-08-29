/* eslint-disable react-hooks/exhaustive-deps */
"use client";
import { useContext, createContext, Dispatch, SetStateAction } from "react";
import { IAttachment, IComment, IUser, StackedType } from "@/models/model";
import useDescriptionAndCommentsStates from "@/hooks/Task Detail/CommentAndDescriptionHooks/useCommentAndDescriptions";
import useDescriptionReactions from "@/hooks/Task Detail/CommentAndDescriptionHooks/useDescriptionReactions";
import { IUploadingDescription } from "@/models/model";

// ========================================================================

interface IShow {
  commentId: number;
  show: boolean;
}

interface DescriptionAndCommentProviderProps {
  descriptionAttachments: IAttachment[];
  setDescriptionAttachments: React.Dispatch<
    React.SetStateAction<IAttachment[]>
  >;
  description: string;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  comments: IComment[];
  setComments: Dispatch<SetStateAction<IComment[]>>;
  stacked: StackedType;
  setStacked: Dispatch<SetStateAction<StackedType>>;
  updateStackedComments: (commentIdx: number, forceOpen?: boolean) => void;
  showEmojiPickerAtComment: IShow | undefined;
  setShowEmojiPickerAtCount: Dispatch<SetStateAction<IShow | undefined>>;
  showCommentOptions: IShow | undefined;
  setShowCommentOptions: Dispatch<SetStateAction<IShow | undefined>>;
  toggleCommentOptionsModal: (commentIndex: number) => void;
  toggleEmojiPicker: (commentIndex: number) => void;
  replyQuote: string | null;
  showEmojiPickerDescription: boolean;
  setShowEmojiPickerDescription: Dispatch<SetStateAction<boolean>>;
  handleClickOutside: (event: any) => void;
  toggleEmojiPickerDescription: () => void;
  emojiClickHandlerDescriptionr: (emojiData: any) => Promise<void>;
  uploadingComments: any[];
  setUploadingComments: (payload: any) => unknown;
  uploadingDescription: IUploadingDescription | undefined;
  setUploadingDescription: React.Dispatch<
    React.SetStateAction<IUploadingDescription | undefined>
  >;
  InsertContentInCommentInput: (content: string, quoter: IUser) => void;
  editDescriptionHandler: () => void;
  editCommentHandler: (currentIndex: number) => void;
  replyToCommentHandler: (currentIndex: number) => string | undefined;
  emojiFinder: (unicodeValue: any) => string;
  showCommentDeleteModal: boolean;
  toggleCommentDeleteHandler: (val: boolean) => void;
  resetDraft: "Comment" | "Description" | undefined;
  setResetDraft: Dispatch<
    SetStateAction<"Comment" | "Description" | undefined>
  >;
}
const DescriptionAndCommentsProvider: React.FC<any> = ({ children }) => {
  const descriptionStatesAndFunctions = {
    ...useDescriptionAndCommentsStates(),
  };

  return (
    <DescriptionAndCommentContext.Provider
      value={descriptionStatesAndFunctions}
    >
      {children}
    </DescriptionAndCommentContext.Provider>
  );
};

const DescriptionAndCommentContext = createContext<
  DescriptionAndCommentProviderProps | undefined
>(undefined);

export const useDescriptionAndCommentsContext = () => {
  const context = useContext(DescriptionAndCommentContext);
  if (!context) {
    throw new Error(
      "useDescriptionAndCommentsContext must be used within DescriptionAndCommentsProvider"
    );
  }
  return context;
};

export default DescriptionAndCommentsProvider;
