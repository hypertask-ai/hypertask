import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { measuredSizeNumber, measuredSizeString } from "@/lib/attachments/measuredSize";
import {
  IAttachment,
  IComment,
  IEditorAttachmentFile,
  IUrl,
  modifiedHtml,
  NavigateToNextTaskParams,
  RedirectAPIParams,
  THyperMention,
  TImageMention,
  TPostFollowerBody,
} from "@/models/model";
import {
  base64ToFile,
  cancelPendingDraftUpdates,
  updateComment,
  updateTask,
} from "@/utils/api/Task Detail";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import toast from "react-hot-toast";
import axios from "axios";
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useQueryClient } from "@tanstack/react-query";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { useFollowersContext } from "@/lib/contexts/TaskDetail/FollowersProvider";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import globalConstants from "@/lib/constants";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { useTaskRelations } from "../useTaskRelations";
import { useHyperMention } from "@/hooks/MultiPages/Tasks/useHyperMention";
import { USER_DRAFTS_QUERY_KEY } from "@/hooks/General/useGetUserDrafts";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import {
  defaultAiModelOption,
  getAiModelOptionById,
  resolveAiImageModelMention,
  resolveAiModelMention,
} from "@/lib/aiModelOptions";
import { getAiModelPreferenceIds } from "@/lib/aiModelPreferences";
import { LEARN_TUTORIAL_COMMENT_SAVED_EVENT } from "@/lib/tutorial/learnTutorialState";
import { uploadSingleFileViaApi } from "@/lib/storage/uploadViaApi";

export default function useSaveContent() {
  const {
    focusOn,
    currentTask,
    setEditMode,
    setEditState,
    hasDraftInit,
    setHasDraftInit,
    setCurrentTask,
    scrollVirtualize,
    description,
  } = useTaskContext();

  const {
    setDescription,
    setDescriptionAttachments,
    comments,
    setComments,
    setUploadingDescription,
    setUploadingComments,
    uploadingDescription
  } = useDescriptionAndCommentsContext();
  const { PostFollower, PostMention, handleAgentMention } = useFollowersContext();
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  const [currentProject] = useRecoilState(currentProjectAtom);
  const queryClient = useQueryClient();
  const _mbl = useContext(MobileViewContext);
  const hyperAiId = process.env.NEXT_PUBLIC_HYPERAI_ID || "332";
  const { resetDescriptionQuery } = useProjectQuery();
  const { addRelations } = useTaskRelations();
  const { postHyperMention, postImageGeneration } = useHyperMention();
  const { data: userPreferences } = useGetUserPreferences();
  const improveWritingOptionIds = getAiModelPreferenceIds(
    userPreferences.aiModelPreferences,
    "improveWriting",
    currentProject?.teamId,
  );
  const improveWritingOption =
    getAiModelOptionById(improveWritingOptionIds.teamScoped) ??
    getAiModelOptionById(improveWritingOptionIds.global);
  const improveWritingModel =
    improveWritingOption?.id ??
    currentProject?.ai_custom_instructions?.[0]?.model_selected ??
    defaultAiModelOption.id;
  const improveWritingSource =
    improveWritingOption?.source ??
    currentProject?.ai_custom_instructions?.[0]?.source_selected ??
    defaultAiModelOption.source;
  const invalidateUserDrafts = () => {
    queryClient.invalidateQueries({
      queryKey: USER_DRAFTS_QUERY_KEY(currentUser?.id),
    });
  };

  //  --------------------- HTML PARSE TO DETECT IMAGES TO UPLOAD TO AWS + SEPARATE LINKS TO SAVE THEM AGAINST COMMENT AND TASK IN DB
  function processHtml(
    htmlString: string,
    callback?: React.Dispatch<React.SetStateAction<number>>
  ): Promise<modifiedHtml> {
    return new Promise((resolve, reject) => {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, "text/html");
        const imgTags = doc.querySelectorAll("img");
        const anchorTags = doc.querySelectorAll("a");
        const embedTags = doc.querySelectorAll("iframe");

        const uniqueAnchorUrls: IUrl[] = [];
        const urlsArray: string[] = [];
        const PostFollowerBody: TPostFollowerBody[] = [];
        const agentMentions: string[] = [];
        const relatedTasks: { uniqueIndex: string; projectId: string }[] = [];
        let hyperMention: THyperMention = undefined;
        let imageMention: TImageMention = undefined;

        // Helper function to add URL if not already present
        const addUrlIfUnique = (url: string, title: string) => {
          if (url && !urlsArray.includes(url)) {
            uniqueAnchorUrls.push({
              TaskId: currentTask?.id!,
              urlString: url,
              title: title.length > 0 ? title : url,
            });
            urlsArray.push(url);
          }
        };

        // Convert project span tags to anchor tags
        const spanProjectElements = doc.querySelectorAll(
          'span[data-label^="project"]'
        );
        spanProjectElements.forEach((spanElement) => {
          try {
            const projectId = spanElement.getAttribute("projectId");
            if (!projectId) return;

            const aElement = doc.createElement("a");
            aElement.innerHTML = spanElement.innerHTML;
            aElement.setAttribute("href", `/project?id=${projectId}`);

            Array.from(spanElement.attributes).forEach((attr) => {
              aElement.setAttribute(attr.name, attr.value);
            });

            spanElement.replaceWith(aElement);
            const url = aElement.getAttribute("href");
            if (url) {
              addUrlIfUnique(url, aElement.innerHTML);
            }
          } catch (error) {
            console.error("Error processing project span:", error);
          }
        });

        // Convert task span tags to anchor tags
        const spanElements = doc.querySelectorAll('span[data-label="task"]');
        spanElements.forEach((spanElement) => {
          try {
            const projectId = spanElement.getAttribute("projectId");
            const index = spanElement.getAttribute("uniqueIndex");
            if (!projectId || !index) return;

            const aElement = doc.createElement("a");
            aElement.innerHTML = spanElement.innerHTML;
            aElement.setAttribute(
              "href",
              `/detail/project-${projectId}/${index}`
            );

            Array.from(spanElement.attributes).forEach((attr) => {
              aElement.setAttribute(attr.name, attr.value);
            });

            spanElement.replaceWith(aElement);
            const url = aElement.getAttribute("href");
            if (url) {
              addUrlIfUnique(url, aElement.innerHTML);
              relatedTasks.push({ uniqueIndex: index, projectId });
            }
          } catch (error) {
            console.error("Error processing task span:", error);
          }
        });

        // Process user mentions
        const userSpans = doc.querySelectorAll('[data-label^="name"]');
        let hyperMentionProcessed = false;

        userSpans.forEach((userSpan) => {
          try {
            const dataLabel = userSpan.getAttribute("data-label");
            if (!dataLabel) return;

            const parts = dataLabel.split("-");
            const userIdNum = Number(parts.at(-1));
            const currentTaskIdNum = Number(currentTask?.id);

            if (isNaN(userIdNum) || isNaN(currentTaskIdNum)) return;

            const mentionBody = {
              userId: userIdNum,
              currentTaskId: currentTaskIdNum,
            };

            const isHyperMention = String(userIdNum) === String(hyperAiId);

            if (isHyperMention && !hyperMentionProcessed) {
              hyperMentionProcessed = true;
              const hyperMentionSpans = doc.querySelectorAll(
                `[data-label="name-${hyperAiId}"]`
              );

              const isNotInBlockquote = Array.from(hyperMentionSpans).some(
                (span) => !span.closest("blockquote")
              );

              if (isNotInBlockquote) {
                hyperMentionSpans.forEach((span) => {
                  if (!span.closest("blockquote")) {
                    const displayName = span.getAttribute("data-id");
                    const imageModelMention =
                      resolveAiImageModelMention(displayName);
                    const modelMention = resolveAiModelMention(displayName);
                    if (imageModelMention) {
                      imageMention = {
                        ...mentionBody,
                        modelKey: imageModelMention.key,
                      };
                    } else if (modelMention) {
                      hyperMention = {
                        ...mentionBody,
                        modelLabel: modelMention.definition.label,
                        modelOptionId: modelMention.modelOption.id,
                        modelSource: modelMention.modelOption.source,
                      };
                    } else if (displayName === "HyperAI" && !hyperMention) {
                      hyperMention = mentionBody;
                    }
                  }
                });
              }

              hyperMentionSpans.forEach((span, idx) =>
                span.setAttribute("hyper-index", `${idx}`)
              );
            } else if (!isHyperMention) {
              PostFollowerBody.push(mentionBody);
            }
          } catch (error) {
            console.error("Error processing user mention:", error);
          }
        });

        // Process agent mentions
        const agentSpans = doc.querySelectorAll('[data-label^="agent"]');
        const seenAgentIds = new Set<string>();
        agentSpans.forEach((agentSpan) => {
          try {
            const dataLabel = agentSpan.getAttribute("data-label");
            if (!dataLabel) return;
            const agentId = dataLabel.startsWith('agent-') ? dataLabel.slice('agent-'.length) : undefined;
            if (!agentId || !currentTask?.id || seenAgentIds.has(agentId)) return;
          
            seenAgentIds.add(agentId);
            agentMentions.push(agentId);
          } catch (error) {
            console.log("🚀 ~ processHtml ~ error processing agent mentions:", error);
          }
        });

        // Convert blob URL to base64
        const blobToBase64 = async (url: string): Promise<string> => {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`Failed to fetch blob: ${response.statusText}`);
            }
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = reject;
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
          } catch (error) {
            console.error("Error converting blob to base64:", error);
            throw error;
          }
        };

        // Process and convert images
        const convertImages = async (): Promise<void> => {
          for (const imgTag of imgTags) {
            try {
              const src = imgTag.getAttribute("src");
              if (!src) {
                callback?.((prev) => prev + 1);
                continue;
              }

              if (src.startsWith("data:image")) {
                const newUrl = await base64ToFile(src, "image.png");
                addUrlIfUnique(
                  src,
                  newUrl.substring(newUrl.lastIndexOf("/") + 1)
                );
                imgTag.setAttribute("src", newUrl);
              } else if (src.startsWith("blob:")) {
                const base64FromBlob = await blobToBase64(src);
                const newUrl = await base64ToFile(base64FromBlob, "image.png");
                addUrlIfUnique(
                  src,
                  newUrl.substring(newUrl.lastIndexOf("/") + 1)
                );
                imgTag.setAttribute("src", newUrl);
              } else {
                addUrlIfUnique(src, src.substring(src.lastIndexOf("/") + 1));
              }
            } catch (error) {
              console.error("Error processing image:", error);
            } finally {
              callback?.((prev) => prev + 1);
            }
          }
        };

        // Process embed URLs
        const processEmbedUrls = (): void => {
          embedTags.forEach((embed) => {
            try {
              const url = embed.getAttribute("src");
              if (!url || urlsArray.includes(url)) return;

              let title = "Embedded Content";

              try {
                const urlObj = new URL(url);

                if (urlObj.hostname.includes("figma.com")) {
                  const embedTitle = urlObj.searchParams.get("embed_title");
                  title = embedTitle
                    ? `Figma Embed: ${decodeURIComponent(embedTitle)
                        .replace(/\s+/g, " ")
                        .trim()}`
                    : "Figma Design";
                } else if (urlObj.hostname.includes("loom.com")) {
                  const videoId = url
                    .split("/")
                    .filter(Boolean)
                    .pop()
                    ?.split("?")[0];
                  title = `Loom Recording: ${videoId}`;
                } else if (urlObj.hostname.includes("youtube.com")) {
                  const videoId =
                    urlObj.searchParams.get("si")?.split("-")[0] ||
                    url.split("/").pop();
                  title = `YouTube Video: ${videoId}`;
                }
              } catch (urlError) {
                console.error("Error parsing embed URL:", urlError);
              }

              addUrlIfUnique(url, title);
            } catch (error) {
              console.error("Error processing embed:", error);
            }
          });
        };

        // Process all elements
        convertImages()
          .then(() => {
            // Process anchor tags
            anchorTags.forEach((anchor) => {
              try {
                const url = anchor.getAttribute("href");
                const title = anchor.innerText;
                if (url) {
                  addUrlIfUnique(url, title);
                }
              } catch (error) {
                console.error("Error processing anchor:", error);
              }
            });

            // Process embed URLs
            processEmbedUrls();

            const returnHtml: modifiedHtml = {
              html: doc.documentElement.outerHTML,
              urls: uniqueAnchorUrls,
              relations: {
                relatedTasks,
                currentTaskId: currentTask?.id!,
              },
              PostFollowerBody,
              agentMentions,
              hyperMention,
              imageMention,
            };

            resolve(returnHtml);
          })
          .catch((error) => {
            console.error("Error in convertImages:", error);
            reject(error);
          });
      } catch (error) {
        console.error("Error in processHtml:", error);
        reject(error);
      }
    });
  }

  const updateDescriptionfromAI = async (descriptionContent: string = "") => {
    try {
      cancelPendingDraftUpdates();
      const newTask = {
        description: descriptionContent,
        id: currentTask?.id,
      };
      setDescription(descriptionContent ?? "");
      resetDescriptionQuery(currentTask?.id!, currentUser.id);
      setHasDraftInit(false);
      const response = await updateTask(newTask);
      if (response.status === 200) {
        invalidateUserDrafts();
        return "Success";
      }
      else throw "Failed";
    } catch (error) {
      console.log("🚀 ~ updateDescriptionfromAI ~ error:", error);
      return { error, message: "failed" };
    } finally {
      focusOn(descriptionContainerId, false);
      scrollVirtualize("description");
      setEditMode(null);
    }
  };
  // ---------------------- SAVE DESCRIPTION -------------------
  const handleSubmit = async (
    unprocessedHTML: string,
    result: modifiedHtml | null,
    attachments?: IEditorAttachmentFile[]
  ) => {
    let saved = false;
    const completeDescriptionSave = uploadingDescription?.onComplete;
    cancelPendingDraftUpdates();
    if (currentTask?.id && currentUser?.id) {
      resetDescriptionQuery(currentTask.id, currentUser.id);
      setHasDraftInit(false);
    }

    focusOn(descriptionContainerId, false);
    scrollVirtualize("description");
    if (result) {
      try {
        // const result: any = await processHtml(content);
        const newTask = {
          description: result.html,
          id: currentTask?.id,
        };
        const { AttachmentObjectsToPush, AttachmentUrls } =
          await uploadAttachmentsDescription(attachments);

        const payload = {
          urlsToAdd: [...(result.urls ?? []), ...AttachmentUrls],
          taskId: currentTask?.id,
        };
        const response = await updateTask(newTask, payload, "SaveDescription");
        // console.log(data);

        //remove duplicates
        const uniquePostFollowerBody = result.PostFollowerBody.filter(
          (x: any, index: number, self: any[]) =>
            index === self.findIndex((y: any) => y.userId === x.userId)
        );

        uniquePostFollowerBody.forEach((x: any) => {
          PostFollower(x.userId, x.currentTaskId);
          PostMention(x.userId, x.currentTaskId);
        });

        result.agentMentions?.forEach((agentId: string) => {
          handleAgentMention(agentId, currentTask?.id!);
        });
        
        if (response.status === 200) {
          setDescription(result.html ?? unprocessedHTML ?? "");
          if (result.hyperMention && currentTask)
            postHyperMention("Description", "Update", {
              ownerId: currentTask.userId,
              projectId: currentProject?.id ?? -1,
              teamId: currentProject?.teamId ?? "-1",
              text: result.html,
              currentUser: currentUser ?? undefined,
              teamTitle: currentProject?.team?.title ?? "",
              taskIds: [
                currentTask.id,
                currentTask.parentTask?.id,
                ...(currentTask.subTasks || []).flatMap((item) => item.id),
                ...(currentTask.relatedFromTasks || []).flatMap(
                  (item) => item.targetTask?.id
                ),
                ...(currentTask.relatedToTasks || []).flatMap(
                  (item) => item.sourceTask?.id
                ),
              ].filter(Boolean),
              sourceSelected:
                result.hyperMention.modelSource ?? improveWritingSource,
              modelSelected:
                result.hyperMention.modelOptionId ?? improveWritingModel,
              modelOptionId: result.hyperMention.modelOptionId,
              modelMentionLabel: result.hyperMention.modelLabel,
              attachments,
              taskDescription: result.html,
              taskTitle: currentTask.title,
              previousText: currentTask.description_.content,
            });
          else if (result.imageMention && currentTask)
            postImageGeneration("Update", {
              text: result.html,
              projectId: currentProject?.id ?? -1,
              taskId: currentTask.id,
              modelKey: result.imageMention.modelKey,
              previousText: currentTask.description_.content,
            });

          await addRelationsHandler(result.relations);
          resetDescriptionQuery(currentTask?.id!, currentUser.id);
          invalidateUserDrafts();
          setDescriptionAttachments(AttachmentObjectsToPush);
          const newComment: any = response.data.newComment;
          const updatedComments = [
            ...comments,
            {
              ...newComment,
              text: "", // Consider providing a meaningful text or removing this field if not needed
              taskId: currentTask?.id,
              activity: {
                type: "TaskDescriptionUpdate",
                data: {
                  fromUserId: currentUser?.id!,
                  fromUserDisplayName: currentUser?.displayName ?? "",
                  fromUser: currentUser!,
                },
              },
              creator: {
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL,
                id: currentUser.id,
              },
              createdAt: new Date(),
            },
          ];
          const stack_: any = queryClient.getQueryData([
            globalConstants.CommentStackStatusKey,
          ]);
          const newInitialMap: any = {};
          updatedComments.slice(0, -1).map((item: IComment, index: number) => {
            newInitialMap[index] = item.seen?.includes(currentUser.id)
              ? stack_?.stack
              : false;
          });
          setComments(updatedComments);
          queryClient.setQueryData(
            [globalConstants.CommentsTQPrefixKey, currentTask?.id],
            (prev: any) => ({
              comments: updatedComments,
              stacked: newInitialMap,
            })
          );
          if (hasDraftInit) setHasDraftInit(false);
          saved = true;
        }
      } catch (error) {
        console.log("🚀 ~ handleSubmit ~ error:", error)
        toast.error("Could not save description. Your changes are still here.");
      } finally {
        console.log(
          " ============= Description upload finished ================="
        );
        setUploadingDescription(undefined);
        completeDescriptionSave?.(saved);
        if (saved) setEditMode(null);
      }
    } else {
      setUploadingDescription(undefined);
      completeDescriptionSave?.(false);
    }
    return saved;
  };

  // ---------------------- SAVE COMMENTS -------------------
  const updateCommentHandler = async (
    content: string | undefined,
    id: string,
    attachments?: IEditorAttachmentFile[],
  ) => {
    if (
      currentTask &&
      comments &&
      setComments &&
      comments.length > 0 &&
      content
    ) {
      try {
        const currentIndex = document.activeElement?.id.split("-")[1];
        if (currentIndex !== undefined) {
          scrollVirtualize("comment", parseInt(currentIndex));
        }
        const result = await processHtml(content);
        // console.log("🚀 ~ file: TaskDetailComp.tsx:1616 ~ updateCommentHandler ~ result:", result)
        const comment = comments.find((comment) => comment.id === id);
        if (!comment) {
          toast.error("This comment no longer exists. Refresh the task and try again.");
          return false;
        }

        const shouldSyncAttachments = attachments !== undefined;
        let attachmentObjectsToPush = comment.attachments ?? [];
        let attachmentUrls: IUrl[] = attachmentObjectsToPush.map(
          (attachment) => ({
            TaskId: currentTask.id,
            urlString: attachment.fileSource,
            Attachment: true,
            title: attachment.fileName,
            fileSize: measuredSizeNumber(attachment.fileSize),
          }),
        );
        if (shouldSyncAttachments) {
          const uploadedAttachments = await Promise.all(
            attachments.map(async (attachment) => {
              if (attachment.source) return attachment;
              if (!(attachment instanceof File)) {
                throw new Error("Attachment upload source is missing");
              }
              const source = await uploadSingleFileViaApi(attachment);
              return {
                name: attachment.name,
                size: attachment.size,
                type: attachment.type,
                source,
              };
            }),
          );
          const uploaded = await uploadAttachmentsComments(
            uploadedAttachments,
            Number(id),
          );
          attachmentObjectsToPush = uploaded.AttachmentObjectsToPush;
          attachmentUrls = uploaded.AttachmentUrls;
        }
        const urlsToSave = [...(result.urls ?? []), ...attachmentUrls];
        const updatedComment = {
          text: result.html,
          creatorId: currentUser?.id,
          commentId: id,
          taskId: currentTask?.id,
          attachments: shouldSyncAttachments
            ? attachmentObjectsToPush.map(
                ({ fileType, fileSource, fileName, fileSize }) => ({
                  fileType,
                  fileSource,
                  fileName,
                  fileSize,
                }),
              )
            : undefined,
          replaceAttachments: shouldSyncAttachments,
        };

        const response = await updateComment(updatedComment, urlsToSave, id);
        if (result.hyperMention)
          postHyperMention("Comment", "Update", {
            ownerId: currentTask.userId,
            projectId: currentProject?.id ?? -1,
            teamId: currentProject?.teamId ?? "-1",
            text: result.html,
            currentUser: currentUser ?? undefined,
            teamTitle: currentProject?.team?.title ?? "",
            taskIds: [
              currentTask.id,
              currentTask.parentTask?.id,
              ...(currentTask.subTasks || []).flatMap((item) => item.id),
              ...(currentTask.relatedFromTasks || []).flatMap(
                (item) => item.targetTask?.id
              ),
              ...(currentTask.relatedToTasks || []).flatMap(
                (item) => item.sourceTask?.id
              ),
            ].filter(Boolean),
            sourceSelected:
              result.hyperMention.modelSource ?? improveWritingSource,
            modelSelected:
              result.hyperMention.modelOptionId ?? improveWritingModel,
            modelOptionId: result.hyperMention.modelOptionId,
            modelMentionLabel: result.hyperMention.modelLabel,
            taskDescription: description,
            taskTitle: currentTask.title,
            attachments: attachmentObjectsToPush,
            previousText: comment.text,
            sourceCommentId: id,
          });
        else if (result.imageMention)
          postImageGeneration("Update", {
            text: result.html,
            projectId: currentProject?.id ?? -1,
            taskId: currentTask.id,
            modelKey: result.imageMention.modelKey,
            previousText: comment.text,
          });

        const data = await response.data;
        if (response.status == 200) {
          toast("Comment updated successfully!");
          setComments((prev) => {
            const updatedComments = prev.map((comment) => {
              if (comment.id === data.id) {
                return data;
              }
              return comment; // Keep other comments unchanged
            });
            return updatedComments;
          });
          setEditState(null);
          setEditMode(null);
          return true;
        } else {
          console.error("Error updating comment:", data.error); // You might want to handle the error in a better way
        }
      } catch (error) {
        console.error(error);
        toast.error("Could not update comment. Your changes are still here.");
      }
    }
    return false;
  };

  // ---------------------- CREATE COMMENT -------------------
  const createComment = async (
    result: any,
    content: string,
    CommentText: string,
    attachments: any[],
    uploadingCommentId: number,
    rawAttachmentsForHyper?: File[],
    // The task this comment was composed against, captured when the user hit
    // send. currentTask is only a fallback: by the time this runs the user may
    // already be looking at a different task (HTPR-3175).
    composedForTaskId?: number,
    composedForOwnerId?: number
  ) => {
    if (
      comments &&
      setComments &&
      content.length !== 0 &&
      currentTask &&
      content &&
      content.length > 0
    ) {
      focusOn("comment", true, "auto", "center", true);

      console.log("🚀 ~ useSaveContent ~ result:", result);
      let data: any;
      try {
        ({ data } = await axios.post("/api/comments/create", {
          text: result.html,
          creatorId: currentUser?.id,
          taskId: composedForTaskId ?? currentTask.id,
          ownerId: composedForOwnerId ?? currentTask.userId,
        }));
      } catch (err: any) {
        // HTPR-3803: a logged-off user gets a 401 here. Send them to login
        // instead of stranding them on the task page with only a toast.
        if (err?.response?.status === 401) {
          toast.error("Please log in to comment");
          window.location.href = "/login";
          return;
        }
        throw err;
      }

      const hyperAiAttachmentPayload =
        rawAttachmentsForHyper && rawAttachmentsForHyper.length > 0
          ? rawAttachmentsForHyper
          : attachments;

      if (result.hyperMention)
        postHyperMention("Comment", "Create", {
          ownerId: currentTask.userId,
          projectId: currentProject?.id ?? -1,
          teamId: currentProject?.teamId ?? "-1",
          text: result.html,
          currentUser: currentUser ?? undefined,
          teamTitle: currentProject?.team?.title ?? "",
          taskIds: [
            currentTask.id,
            currentTask.parentTask?.id,
            ...(currentTask.subTasks || []).flatMap((item) => item.id),
            ...(currentTask.relatedFromTasks || []).flatMap(
              (item) => item.targetTask?.id
            ),
            ...(currentTask.relatedToTasks || []).flatMap(
              (item) => item.sourceTask?.id
            ),
          ].filter(Boolean),
          sourceSelected:
            result.hyperMention.modelSource ?? improveWritingSource,
          modelSelected:
            result.hyperMention.modelOptionId ?? improveWritingModel,
          modelOptionId: result.hyperMention.modelOptionId,
          modelMentionLabel: result.hyperMention.modelLabel,
          attachments: hyperAiAttachmentPayload,
          taskDescription: description,
          taskTitle: currentTask.title,
          sourceCommentId: Number(data.id),
        });
      else if (result.imageMention)
        postImageGeneration("Create", {
          text: result.html,
          projectId: currentProject?.id ?? -1,
          taskId: currentTask.id,
          modelKey: result.imageMention.modelKey,
        });

      // ===================== add attachments and urls ===========
      const { AttachmentObjectsToPush, AttachmentUrls } =
        await uploadAttachmentsComments(attachments, data.id);

      setUploadingComments((prev: any[]) =>
        prev.filter((item) => item.id !== uploadingCommentId)
      );
      invalidateUserDrafts();

      if (data) {
        const newInitialMap: any = {};
        const updatedComments = [
          ...comments,
          {
            ...data,
            text: result.html,
            creator: {
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              id: currentUser.id,
            },
            attachments: AttachmentObjectsToPush,
          },
        ];
        setComments(updatedComments);
        window.dispatchEvent(
          new CustomEvent(LEARN_TUTORIAL_COMMENT_SAVED_EVENT, {
            detail: { taskId: composedForTaskId ?? currentTask.id },
          }),
        );

        const stack_: any = queryClient.getQueryData([
          globalConstants.CommentStackStatusKey,
        ]);
        updatedComments.slice(0, -1).map((item: IComment, index: number) => {
          newInitialMap[index] = item.seen?.includes(currentUser.id)
            ? stack_?.stack
            : false;
        });

        queryClient.setQueryData(
          [globalConstants.CommentsTQPrefixKey, currentTask?.id],
          (prev: any) => ({
            comments: updatedComments,
            stacked: newInitialMap,
          })
        );

        if (!_mbl) {
          toast("Comment added successfully!");
        }
        // Mobile: no "sent" toast. Sending a comment isn't revertible and the
        // now-empty composer is confirmation enough — a toast here only got in
        // the way. Reserve toasts for revertible actions (the undo pill).
        // Per Valentin, 2026-07-24.

        // Comment and mention emails are handled server-side in createCommentService
        // so every transport sends them exactly once.
        let urlsToAdd = [...result.urls, ...AttachmentUrls];

        if (urlsToAdd.length > 0) {
          // Must await: createComment resolves into a ~100ms setTimeout -> navigateToNextTask
          // in UploadingCommentContainer. A fire-and-forget fetch races that navigation/unmount,
          // so the attachment row never lands and the comment reloads empty (HTPR-3794).
          // The edit path (updateComment) already awaits this same call.
          await fetch(`/api/urls/addIntoTask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              urlsToAdd,
              commentId: data.id,
              title: currentTask.title,
            }),
          });
        }

        if(result.relations.length>0) addRelationsHandler(result.relations);
      }
    }
  };
  const addRelationsHandler = async (relations: any) => {
    const response = await addRelations(relations);
    if (response) {
      // @ts-ignore
      setCurrentTask((prev) => {
        return {
          ...prev,
          relatedFromTasks: [
            ...(prev?.relatedFromTasks ?? []),
            ...response.data,
          ],
        };
      });
    }
  };

  const uploadAttachmentsDescription = async (
    attachments: any[] | undefined
  ) => {
    // =========================== handle incoming attachments + already uploaded attachments
    // missing source means it needs to be uploaded first *WE ARE CHANGING THAT NOW
    // NEW:
    //   1: We will append source from the deepest component, send it back in callbacl.
    //   2: In the parent uploading component, we will then send back the entire array,
    //   3: if an item doesn't have createdAt, it means its a new attachment.

    var AttachmentUrls: IUrl[] = [];
    var AttachmentObjectsToPush: IAttachment[] = [];

    if (attachments) {
      const attachmentsToUpload = attachments.filter(
        (item) => !item.createdAt || !item.taskId
      );
      const previousAttachments: any[] = attachments.filter((attachment) =>
        attachment.id > -1 ? attachment : null
      );

      if (previousAttachments || attachmentsToUpload) {
        // const uploadedAttachments: string[] = await uploadDocumentsToS3(
        //   attachmentsToUpload,
        //   currentTask?.id!
        // );

        const timenow = Date.now();
        attachmentsToUpload.forEach((attch, index) => {
          if (attch) {
            let urlToAdd: IUrl = {
              TaskId: currentTask?.id!,
              urlString: attch.source as string,
              Attachment: true,
              title: attch.name,
              attachmentType: attch.type,
              fileSize: measuredSizeNumber(attch.size),
            };
            AttachmentObjectsToPush.push({
              id: index,
              createdAt: timenow,
              fileType: attch.type,
              fileSource: attch.source as string,
              fileName: attch.name,
              fileSize: measuredSizeString(attch.size),
              descriptionId: currentTask?.description_.id!,
              taskId: currentTask?.id!,
            });
            AttachmentUrls.push(urlToAdd);
          }
        });

        previousAttachments.forEach((attachment, index) => {
          let urlToAdd: IUrl = {
            TaskId: currentTask?.id!,
            urlString: attachment.source as string,
            Attachment: true,
            title: attachment.name,
            attachmentType: attachment.type,
            fileSize: measuredSizeNumber(attachment.size ?? attachment.fileSize),
          };
          AttachmentUrls.push(urlToAdd);
          AttachmentObjectsToPush.push({
            id: index,
            createdAt: timenow,
            fileType: attachment.type,
            fileSource: attachment.source,
            fileName: attachment.name,
            fileSize: measuredSizeString(attachment.size ?? attachment.fileSize),
            descriptionId: currentTask?.description_.id!,
            taskId: currentTask?.id!,
          });
        });
      }
    }
    return { AttachmentUrls, AttachmentObjectsToPush };
  };
  const uploadAttachmentsComments = async (
    newCommentAttachments: any[],
    commentId: number
  ) => {
    var AttachmentUrls: IUrl[] = [];
    var AttachmentObjectsToPush: IAttachment[] = [];

    // NEW:
    //   1: We will append source from the deepest component, send it back in callbacl.
    //   2: In the parent uploading component, we will then send back the entire array,
    //   3: instead of reading URL, we'll read .source because that means the file is uploaded and ready to add.

    // const urlStrings: string[] = await uploadDocumentsToS3(
    //   newCommentAttachments,
    //   currentTask?.id!
    // );
    newCommentAttachments.forEach((newAtt, index) => {
      const timenow = Date.now();

      let urlToAdd: IUrl = {
        TaskId: currentTask?.id!,
        urlString: newAtt.source as string,
        Attachment: true,
        title: newAtt.name,
        attachmentType: newAtt.type,
        fileSize: measuredSizeNumber(newAtt.size),
      };
      AttachmentObjectsToPush.push({
        id: index,
        createdAt: timenow,
        fileType: newAtt.type,
        fileSource: newAtt.source as string,
        fileName: newAtt.name,
        fileSize: measuredSizeString(newAtt.size),
        commentId,
        taskId: currentTask?.id!,
      });
      AttachmentUrls.push(urlToAdd);
    });
    return { AttachmentUrls, AttachmentObjectsToPush };
  };

  // API HANDLER, based on save type, redirect to correct api functions
  const redirectAPI = async ({
    content,
    text,
    attachments_,
    id,
    mode,
    navigateToNext: movetonext,
    inbox = false,
    inboxFlow = undefined,
    markAsDone = undefined,
    taskStatus = "Normal",
  }: RedirectAPIParams) => {
    const attachments =
      attachments_?.map((att, index) => ({ file: att, id: index })) ?? [];

    const parser = new DOMParser();
    var doc = parser.parseFromString(content, "text/html");
    const imgTags = doc.querySelectorAll(
      'img[src^="data:image"], img[src^="blob:"]'
    );
    const totalAttachments = imgTags.length + attachments.length;

    // console.log("🚀 ~ useSaveContent ~ attachments:", attachments)
    if (mode === "create-comment") {
      // =========== first get the documents and upload them from inside that component thingy.
      // Initialize navigation parameters
      let navigateToNextParams: NavigateToNextTaskParams = {
        archiveNotification: inbox,
        shouldNavigate: movetonext,
        remindMe: movetonext ? false : undefined,
        force: movetonext ? "forceNavigate" : undefined,
        inboxFlow,
        markAsDone,
        taskStatus,
      };

      setUploadingComments((prev: any[]) => [
        ...prev,
        {
          id: Date.now(),
          content,
          attachments: attachments,
          totalAttachments,
          navigateToNextParams,
          // Captured here, at send time. The upload finishes inside another
          // component that re-reads currentTask, so a comment posted while
          // attachments were still uploading landed on whatever task the user
          // had navigated to by then (HTPR-3175).
          taskId: currentTask?.id,
          ownerId: currentTask?.userId,
        },
      ]);
      return true;
    } else if (mode === "read-edit-comments") {
      return updateCommentHandler(content, id, attachments_);
    } else {
      if (uploadingDescription) {
        return false;
      }

      cancelPendingDraftUpdates();
      if (currentTask?.id && currentUser?.id) {
        resetDescriptionQuery(currentTask.id, currentUser.id);
        setHasDraftInit(false);
      }

      return new Promise<boolean>((resolve) => {
        setUploadingDescription({
          content,
          descriptionAttachments: attachments ?? [],
          id: "description",
          totalAttachments,
          onComplete: resolve,
        });
      });
    }
  };

  return {
    redirectAPI,
    processHtml,
    createComment,
    uploadAttachmentsComments,
    handleSubmit,
    updateDescriptionfromAI,
  };
}
