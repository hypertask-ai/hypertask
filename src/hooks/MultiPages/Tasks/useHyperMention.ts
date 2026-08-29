import { useMcpToken } from "@/components/Modals/McpToken";
import { useCurrentBoardBilling } from "@/hooks/General/useCurrentBoardBilling";
import { defaultAiModelOption } from "@/lib/aiModelOptions";
import { IUser } from "@/models/model";
import { processImagesForHyperMention } from "@/utils/helperFunctions/helperFunctions";
import toast from "react-hot-toast";

const DEFAULT_HYPERAI_ERROR = "HyperAI could not reply. Try again.";

async function showHyperAiResponseError(response: Response) {
  const data = await response.json().catch(() => null);
  toast.error(data?.error || data?.message || DEFAULT_HYPERAI_ERROR);
}

interface IPostHyperMention {
  text: string;
  attachments: any;
  ownerId: string | undefined;
  projectId: number;
  teamId: string | undefined;
  teamTitle: string | undefined;
  currentUser: IUser;
  taskIds: (number | undefined)[];
  sourceSelected: string;
  modelSelected: string;
  modelOptionId?: string;
  modelMentionLabel?: string;
  taskDescription: string;
  taskTitle: string;
  previousText?: string;
  sourceCommentId?: number | string;
}

interface IPostImageGeneration {
  text: string;
  projectId: number;
  taskId: number;
  modelKey: string;
  previousText?: string;
}

export function useHyperMention() {
  const { token } = useMcpToken();
  const currentBoardBilling = useCurrentBoardBilling();

  async function postHyperMention(
    postFrom: "Description" | "Comment",
    mode: "Create" | "Update",
    mentionProps: IPostHyperMention
  ) {
    const {
      text,
      attachments,
      projectId,
      currentUser,
      taskIds,
      sourceSelected,
      modelSelected,
      modelOptionId,
      modelMentionLabel,
      previousText,
      ownerId,
      sourceCommentId,
    } = mentionProps;
    const triggerHyper = triggerHyperMention(mode, text, previousText);
    if (!triggerHyper) return;
    const taskId = taskIds[0];
    if (!(taskId !== undefined && taskId > 0)) {
      console.warn("[HyperAI] Missing task context for mention request");
      toast.error("HyperAI could not reply: missing task context");
      return;
    }
    const processedAttachments = await processImagesForHyperMention(
      text,
      attachments
    );
    const images64 = processedAttachments.filter((item) =>
      item.mimeType?.startsWith("image/")
    );
    const pdfs64 = processedAttachments.filter(
      (item) => item.mimeType === "application/pdf"
    );
    const docx64 = processedAttachments.filter(
      (item) =>
        item.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    try {
      const response = await fetch("/api/ai/hyper-mentioned", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          projectId,
          taskId,
          text,
          sourceType: postFrom,
          sourceCommentId,
          user_context: {
            id: currentUser?.id,
            email: currentUser?.email,
            displayName: currentUser?.displayName,
          },
          sourceSelected:
            sourceSelected === "" ? defaultAiModelOption.source : sourceSelected,
          modelSelected:
            modelSelected === "" ? defaultAiModelOption.model : modelSelected,
          modelOptionId:
            modelOptionId ??
            (modelSelected === "" ? defaultAiModelOption.id : modelSelected),
          modelMentionLabel,
          ...(ownerId !== undefined ? { ownerId } : {}),
          images64,
          pdfs64,
          docx64,
          byokProviderFlags: currentBoardBilling?.byokProviderFlags ?? [],
        }),
      });
      if (!response.ok) {
        await showHyperAiResponseError(response);
      }
    } catch (error) {
      console.warn("[HyperAI] Mention request failed", error);
      toast.error(DEFAULT_HYPERAI_ERROR);
    }
  }

  async function postImageGeneration(
    mode: "Create" | "Update",
    mentionProps: IPostImageGeneration
  ) {
    const { text, projectId, taskId, modelKey, previousText } = mentionProps;
    if (!triggerHyperMention(mode, text, previousText)) return;
    if (!(taskId > 0)) {
      console.warn("[HyperAI] Missing task context for image request");
      toast.error("HyperAI could not reply: missing task context");
      return;
    }

    try {
      const response = await fetch("/api/ai/generate-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ projectId, taskId, text, modelKey }),
      });
      if (!response.ok) {
        await showHyperAiResponseError(response);
      }
    } catch (error) {
      console.warn("[HyperAI] Image request failed", error);
      toast.error(DEFAULT_HYPERAI_ERROR);
    }
  }

  function triggerHyperMention(
    mode: "Create" | "Update",
    newText: string,
    previousText?: string
  ) {
    if (mode === "Create") return true;
    if (previousText === undefined) return true;

    const hyperAiId = process.env.NEXT_PUBLIC_HYPERAI_ID || "332";
    const parser = new DOMParser();

    const newTextDoc = parser.parseFromString(newText, "text/html");
    const previousTextDoc = parser.parseFromString(previousText, "text/html");

    const newInfo = getValidHyperMentionInfo(newTextDoc, hyperAiId);
    const prevInfo = getValidHyperMentionInfo(previousTextDoc, hyperAiId);

    if (newInfo.ids.length > 0 || prevInfo.ids.length > 0) {
      const newSortedIds = [...newInfo.ids].sort();
      const prevSortedIds = [...prevInfo.ids].sort();

      if (newSortedIds.length !== prevSortedIds.length) return true;

      const hasSetChanged = newSortedIds.some(
        (id, index) => id !== prevSortedIds[index]
      );

      if (hasSetChanged) return true;
    }

    return (
      newInfo.count !== prevInfo.count ||
      newInfo.labels.join("\n") !== prevInfo.labels.join("\n")
    );
  }

  function getValidHyperMentionInfo(
    doc: Document,
    hyperAiId: string
  ): { ids: string[]; labels: string[]; count: number } {
    const hyperMentionSpans = doc.querySelectorAll(
      `[data-label="name-${hyperAiId}"]`
    );

    const validMentions = Array.from(hyperMentionSpans).filter(
      (span) => span.closest("blockquote") === null
    );

    const ids = validMentions
      .map((span) => span.getAttribute("data-mention-id"))
      .filter((id): id is string => !!id);
    const labels = validMentions
      .map((span) => span.getAttribute("data-id") ?? "")
      .sort();

    return {
      ids: ids,
      labels,
      count: validMentions.length,
    };
  }

  return { postHyperMention, postImageGeneration };
}
