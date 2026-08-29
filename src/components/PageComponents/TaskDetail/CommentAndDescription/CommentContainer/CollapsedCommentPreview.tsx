import { useMemo } from "react";
import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import type { IAttachment } from "@/models/model";
import { convertToPlain } from "@/utils/helperFunctions/helperFunctions";

const MAX_PREVIEW_LENGTH = 150;

const normalizePreviewText = (text: string | undefined) =>
  (text ?? "").replace(/\s+/g, " ").trim();

const getAttachmentPreview = (attachments?: IAttachment[]) => {
  const firstAttachment = attachments?.[0];
  if (!firstAttachment) return "";

  const fileName = normalizePreviewText(firstAttachment.fileName);
  if (fileName) return fileName;

  if (firstAttachment.fileType?.startsWith("image/")) return "Image";
  return "Attachment";
};

const stripHtmlFallback = (html: string) => html.replace(/<[^>]*>/g, " ");

const getCollapsedCommentPreview = (
  commentText: string,
  attachments?: IAttachment[]
) => {
  const plainText = normalizePreviewText(
    convertToPlain(commentText) ?? stripHtmlFallback(commentText)
  );

  if (plainText) return plainText.slice(0, MAX_PREVIEW_LENGTH);

  const attachmentPreview = getAttachmentPreview(attachments);
  if (attachmentPreview) return attachmentPreview;

  if (/<img[\s>]/i.test(commentText)) return "Image";
  return "";
};

const CollapsedCommentPreview = () => {
  const { comment } = useCommentsContext();

  const preview = useMemo(
    () => getCollapsedCommentPreview(comment.text ?? "", comment.attachments),
    [comment.text, comment.attachments]
  );

  if (!preview) return null;

  return (
    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-[10px] text-content text-muted-foreground [grid-column:2] [grid-row:1]">
      {preview}
    </span>
  );
};

export default CollapsedCommentPreview;
