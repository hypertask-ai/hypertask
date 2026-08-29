"use client";
import AttachmentView from "@/components/Common/AttachmentsView";
import { IDraft } from "@/models/model";
import React from "react";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import InnerHTMLDescription from "../../../CommentAndDescription/DescriptionContainer/InnerHtmlDescription";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";

const SharedDescriptionBody = () => {
  const { description, descriptionAttachments } =
    useDescriptionAndCommentsContext();
  const { setCarousalItems } = useTaskContext();

  return (
    <>
      <InnerHTMLDescription
        descriptionText={description}
        id={`description`}
        key={description}
        attachmentsFromProps={descriptionAttachments}
        allowQuote={false}
        setCarousalItems={setCarousalItems}
      />

      <AttachmentView
        active={false}
        attachments={descriptionAttachments}
        setCarousalItems={setCarousalItems}
      />
    </>
  );
};

export default SharedDescriptionBody;
