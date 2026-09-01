import { useCurrentBoardBilling } from "@/hooks/General/useCurrentBoardBilling";
import { shouldBlockAiDueToByokProvider } from "@/lib/byokSelectedProviderGate";
import { TAiModal, TAiMode } from "@/models/AI_Task_writer_model";
import { ITask } from "@/models/model";
import {
  convertFileToBase64,
  getFileTypeFromBase64,
} from "@/utils/helperFunctions/helperFunctions";
import {
  getFileTypeFromUrl,
  IMAGE_FALLBACK_MIME,
} from "@/utils/helperFunctions/getFileTypeFromUrl";
import { useCallback, useEffect, useRef, useState } from "react";
import { taskWriterRoute } from "@/lib/constants/APIRouteConstants";
import { describeTaskWriterFailure } from "@/utils/helperFunctions/describeTaskWriterFailure";
import {
  createTaskWriterMediaTokenFactory,
  extractTaskWriterPromptMedia,
  extractTaskWriterMedia,
  maskTaskWriterMedia,
  restoreTaskWriterMedia,
  type TaskWriterMedia,
} from "@/lib/ai/taskWriterMedia";
import { getTaskWriterTaskIds } from "@/lib/ai/taskWriterTaskIds";
import type { CurrentBoardBilling } from "@/store";
import { buildTaskWriterRequestScope } from "@/lib/ai/taskWriterBoardContext";
// Roughly 100KB of data URI. Below this a pasted image is cheap enough to send as a vision
// input as well; above it, the copy already inside the description is the only one sent.
const INLINE_IMAGE_RESEND_LIMIT = 100_000;

// Custom Hooks
const useAITaskWriter = (
  currentProject: any,
  currentAiOption: TAiModal,
  aiMode: TAiMode,
  additionalContext?: string,
  attachments?: any[],
  description?: string,
  currentTask?: ITask,
  billingOverride?: CurrentBoardBilling | null,
  requestKind: "manual" | "auto-description" = "manual",
) => {
  const [isLoading, setLoading] = useState(false);
  const [aiResponse, setAIResponse] = useState("");
  const [loadingText, setLoadingText] = useState("Thinking...");
  const [hasError, setHasError] = useState(false);
  const lastRequestRef = useRef<{
    prompt: string;
    loadingText: string;
  } | null>(null);
  const taskWriterMediaRef = useRef<TaskWriterMedia[] | null>(null);
  const requestGenerationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const boardBilling = useCurrentBoardBilling();
  const billing = billingOverride === undefined ? boardBilling : billingOverride;

  useEffect(() => {
    requestGenerationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setAIResponse("");
    setLoading(false);
    setHasError(false);

    return () => abortControllerRef.current?.abort();
  }, [currentProject?.id]);

  const processImagesForTaskWriter = useCallback(async () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(description || "", "text/html");
    const imgTags = doc.querySelectorAll("img");
    const imgURLS = [];
    let countBase64 = 0;

    // Process inline images
    for (const img of imgTags) {
      const url = img.src;
      if (url.includes("tasks/attachments")) {
        // Only the URL is sent on, so the MIME type comes from the file name. Fetching the
        // file to read blob.type threw "Failed to fetch" on every task holding a pasted
        // image: the attachment host serves no CORS header (HTPR-4735).
        const mimeType = getFileTypeFromUrl(url, IMAGE_FALLBACK_MIME);
        const fileName = url.substring(url.lastIndexOf("/") + 1);
        imgURLS.push({ fileName, url, mimeType });
      } else if (url.startsWith("data:") && url.length > INLINE_IMAGE_RESEND_LIMIT) {
        // Re-sending a large pasted screenshot pushed some requests past the 4.5MB
        // platform limit (HTPR-4735). The media placeholder preserves its original HTML
        // without asking the model to reproduce the data URI.
        countBase64++;
      } else {
        const mimeType = getFileTypeFromBase64(url);
        imgURLS.push({
          fileName: `unknown-base64-${countBase64}`,
          url,
          mimeType,
        });
        countBase64++;
      }
    }

    // Process attachments (including PDFs, DOCX, etc.)
    if (attachments) {
      for (const attachment of attachments) {
        // Process all file types, not just images
        if (attachment.type || attachment.mimeType) {
          const url = attachment.source || attachment.url;
          if (url?.includes("tasks/attachments")) {
            imgURLS.push({
              fileName: attachment.name || attachment.fileName,
              url,
              mimeType: attachment.type || attachment.mimeType,
            });
          } else {
            // For blob URLs or base64, use the URL directly
            const fileUrl = attachment.url || attachment.source;
            if (fileUrl) {
              imgURLS.push({
                fileName: attachment.name || attachment.fileName,
                url: fileUrl,
                mimeType: attachment.type || attachment.mimeType,
              });
            } else {
              // Fallback to converting file to base64
              const base64Url = await convertFileToBase64(attachment);
              imgURLS.push({
                fileName: attachment.name || attachment.fileName,
                url: base64Url,
                mimeType: attachment.type || attachment.mimeType,
              });
            }
          }
        }
      }
    }

    return imgURLS;
  }, [description, attachments]);

  const sendAIRequest = useCallback(
    async (prompt: string, requestLoadingText = "Thinking...") => {
      const requestGeneration = requestGenerationRef.current + 1;
      requestGenerationRef.current = requestGeneration;
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        if (shouldBlockAiDueToByokProvider(billing, currentAiOption.source)) return;

        lastRequestRef.current = { prompt, loadingText: requestLoadingText };
        setLoadingText(requestLoadingText);
        setAIResponse("");
        setHasError(false);
        setLoading(true);
        const processedURLS = await processImagesForTaskWriter();
        const descriptionToSend =
          currentTask?.description_?.content ?? description ?? "";
        const nextMediaToken = createTaskWriterMediaTokenFactory(
          descriptionToSend,
          prompt,
          additionalContext ?? ""
        );
        const mediaExtraction =
          aiMode === "AiTaskWriter"
            ? extractTaskWriterMedia(descriptionToSend, nextMediaToken)
            : { html: descriptionToSend, media: [] };
        const promptHtmlMediaExtraction =
          aiMode === "AiTaskWriter"
            ? extractTaskWriterMedia(prompt, nextMediaToken)
            : { html: prompt, media: [] };
        const promptUrlMediaExtraction =
          aiMode === "AiTaskWriter"
            ? extractTaskWriterPromptMedia(
                promptHtmlMediaExtraction.html,
                nextMediaToken
              )
            : { html: prompt, media: [] };
        const media = [
          ...mediaExtraction.media,
          ...promptHtmlMediaExtraction.media,
          ...promptUrlMediaExtraction.media,
        ];
        taskWriterMediaRef.current =
          aiMode === "AiTaskWriter" ? media : null;
        const promptToSend =
          aiMode === "AiTaskWriter"
            ? maskTaskWriterMedia(promptUrlMediaExtraction.html, media)
            : prompt;

        // Separate processed files by type
        const images = processedURLS.filter((item) =>
          item.mimeType?.startsWith("image/")
        );
        const pdfs = processedURLS.filter(
          (item) => item.mimeType === "application/pdf"
        );
        const docx = processedURLS.filter(
          (item) =>
            item.mimeType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );

        // Task Writer needs the current ticket id too: the server uses it to
        // load the full description and comment history. Write With AI keeps
        // its broader current/parent/subtask/related-ticket context.
        const taskIds = getTaskWriterTaskIds(currentTask, aiMode);
        const payload = {
          ...buildTaskWriterRequestScope(currentProject, billing),
          PROMPT: additionalContext
            ? `${additionalContext}\n
              Original Description: ${mediaExtraction.html}
              ${promptToSend}`
            : `Original Description: ${mediaExtraction.html}\n${promptToSend}`,
          customInstructions:
            aiMode === "AiTaskWriter"
              ? currentProject?.ai_custom_instructions?.[0]
                ?.customInstruction ?? ""
              : "",
          sourceSelected: currentAiOption.source ?? "",
          modelSelected: currentAiOption.id ?? "",
          modelOptionId: currentAiOption.id ?? "",
          model: currentAiOption.model ?? "",
          aiMode,
          images64: images,
          pdfs64: pdfs,
          docx64: docx,
          taskIds,
          taskTitle: currentTask?.title ?? "",
          taskDescription: mediaExtraction.html,
          requestKind,
        }
        console.log("🚀 ~ sendAIRequest ~ payload:", payload)
        const response = await fetch(taskWriterRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });

        // response.ok was never checked, so a rejected request was indistinguishable from
        // a real outage: every failure surfaced as the same generic sentence below, with
        // no hint of what to do about it (HTPR-4735).
        if (!response.ok) {
          throw new Error(await describeTaskWriterFailure(response));
        }

        const decoder = new TextDecoder();
        const reader = response?.body?.getReader();

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          if (requestGenerationRef.current !== requestGeneration) {
            await reader.cancel();
            return;
          }
          setAIResponse(
            (prev) => prev + decoder.decode(value, { stream: true })
          );
        }
      } catch (error) {
        if (
          abortController.signal.aborted ||
          requestGenerationRef.current !== requestGeneration
        ) return;
        console.error("AI Request Error:", error);
        setHasError(true);
        setAIResponse(
          error instanceof Error && error.message
            ? error.message
            : "An error occurred while processing your request. Please try again."
        );
      } finally {
        if (requestGenerationRef.current === requestGeneration) {
          abortControllerRef.current = null;
          setLoading(false);
        }
      }
    },
    [
      billing,
      currentProject,
      currentAiOption,
      aiMode,
      additionalContext,
      processImagesForTaskWriter,
      requestKind,
    ]
  );

  const retryLastRequest = useCallback(async () => {
    const lastRequest = lastRequestRef.current;
    if (!lastRequest) return;

    await sendAIRequest(lastRequest.prompt, lastRequest.loadingText);
  }, [sendAIRequest]);

  const restoreMedia = useCallback(
    (html: string, appendMissing = true) => {
      const media = taskWriterMediaRef.current;
      return media === null
        ? html
        : restoreTaskWriterMedia(html, media, appendMissing);
    },
    []
  );

  return {
    isLoading,
    aiResponse,
    loadingText,
    setLoadingText,
    sendAIRequest,
    retryLastRequest,
    restoreMedia,
    hasError,
  };
};

export default useAITaskWriter;
