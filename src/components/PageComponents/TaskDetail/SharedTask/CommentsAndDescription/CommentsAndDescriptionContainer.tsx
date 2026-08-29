"use client";
import React, { ReactNode } from "react";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import SharedDescriptionSubtasks from "./Description/DescriptionSubtasks";
import SharedDescriptionContainer from "./Description/DescriptionContainer";
import SharedCommentsProvider from "./Comments/CommentsProvider";
import SharedDescriptionTopRow from "./Description/DescriptionTopRow";
import SharedDescriptionBody from "./Description/DescriptionBody";
import BaseCommentAndDescriptionContainer from "../../CommentAndDescription/BaseCommentAndDescriptionContainer";

const SharedCommentAndDescriptionContainer = ({
  children,
}: {
  children?: ReactNode;
}) => {
  const { uploadingDescription } = useDescriptionAndCommentsContext();
  const { currentTask } = useTaskContext();

  return (
    <BaseCommentAndDescriptionContainer>
      <SharedDescriptionContainer>
        <SharedDescriptionTopRow
          name={currentTask?.user?.displayName ?? ""}
          pfp={currentTask?.user?.photoURL ?? ""}
          isUploadingDescription={uploadingDescription}
        />
        <SharedDescriptionBody/>
        <SharedDescriptionSubtasks />
      </SharedDescriptionContainer>
      <div id="bottom-description" className="h-0" />

      <SharedCommentsProvider />

      {children}
    </BaseCommentAndDescriptionContainer>
  );
};

export default SharedCommentAndDescriptionContainer;
