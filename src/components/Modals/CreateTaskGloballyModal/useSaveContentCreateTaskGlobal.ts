import { IAttachment, ICreateTaskUrl, IUrl, modifiedHtml, THyperMention, TImageMention } from "@/models/model";
import { measuredSizeNumber } from "@/lib/attachments/measuredSize";
import { resolveAiImageModelMention, resolveAiModelMention } from "@/lib/aiModelOptions";
import { base64ToFile } from "@/utils/api/Task Detail";

export function processHtmlForTaskId(
    htmlString: string,
    callback?: React.Dispatch<React.SetStateAction<number>>,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        const hyperAiId = process.env.NEXT_PUBLIC_HYPERAI_ID || "332";
        const uniqueAnchorUrls: IUrl[] = [];
        const urlsArray: string[] = [];
        const PostFollowerBody: any[] = [];
        const agentMentions: string[] = [];
        const parser = new DOMParser();
        console.log("🚀 ~ returnnewPromise ~ htmlString:", htmlString) 
        var doc = parser.parseFromString(htmlString, "text/html");
        console.log("🚀 ~ returnnewPromise ~ doc:", doc)
        const useridarray: any[] = [];
        const imgTags = doc.querySelectorAll(
          'img[src^="data:image"], img[src^="blob:"]'
        );
        const anchorTags = doc.querySelectorAll("a");
        let hyperMention: THyperMention = undefined;
        let imageMention: TImageMention = undefined;
        console.log("🚀 ~ returnnewPromise ~ anchorTags:", anchorTags)

        // convert tasks span tags to achor tags
        const spanElements = doc.querySelectorAll('span[data-label="task"]');
        const relatedTasks :{uniqueIndex: string, projectId: string}[]=[]

        //  console.log("spanelement",spanElements)
        // Iterate through each <span> element and replace it with an <a> element
        spanElements.forEach((spanElement) => {
          const aElement = doc.createElement("a");
          const projectid = spanElement.getAttribute("projectId");
          console.log("🚀 ~ spanElements.forEach ~ projectid:", projectid);
          const index = spanElement.getAttribute("uniqueIndex");
          console.log("🚀 ~ spanElements.forEach ~ index:", index);
          aElement.innerHTML = spanElement.innerHTML;
          // const [text, index, projectid] = aElement.innerHTML.split('-')
          // const index = parts[parts.length - 2];
          // const projectid = parts[parts.length - 1];
          aElement.setAttribute(
            "href",
            `/detail/project-${projectid}/${index}`
          );
          for (const attribute of spanElement.attributes) {
            aElement.setAttribute(attribute.name, attribute.value);
          }

          spanElement.replaceWith(aElement);
          // const modifiedHtmlContent = doc.documentElement.outerHTML;

          // aElement.setAttribute('title', `${aElement.innerHTML}`)
          const url = aElement.getAttribute("href");
          const title = aElement.innerHTML;
          // console.log("urltopush", url);
          if (url && !urlsArray.includes(url)) {
            // console.log("TaskId", currentTask?.id, "urlString", url);
            let urlToAdd: any = {
              // TaskId: taskId,
              urlString: url,
              title: title,
            };


            relatedTasks.push({
              uniqueIndex: index!,
              projectId: projectid!
            })
            // console.log("urlssss",url)
            urlsArray.push(url);
            uniqueAnchorUrls.push(urlToAdd);
          }
          // console.log("elementWithDataLabelinner", modifiedHtmlContent);
        });

        const userspans = doc.querySelectorAll('[data-label^="name"]'); // Use querySelectorAll to select multiple elements
        // const useridarray = [];

        userspans.forEach((userspan) => {
          const dataLabelValue = userspan.getAttribute("data-label");
          useridarray.push(dataLabelValue);
        });
        useridarray.forEach((userspan) => {
          if(userspan){            
            const parts = userspan && userspan.split("-");
            const userid = parts && parts[parts.length - 1];
  
            const body = {
              userId: Number(userid),
            };
  
            //HyperMention check. Ignore HyperAI if its wrapped in blockquotes
            if (userid === hyperAiId) {
              const hyperMentionSpans = doc.querySelectorAll(
                `[data-label="name-${hyperAiId}"]`
              );
  
              hyperMentionSpans.forEach((span) => {
                if (span.closest("blockquote")) return;
                const displayName = span.getAttribute("data-id");
                const imageModelMention = resolveAiImageModelMention(displayName);
                const modelMention = resolveAiModelMention(displayName);
                if (imageModelMention) {
                  imageMention = {
                    ...body,
                    modelKey: imageModelMention.key,
                  };
                } else if (modelMention) {
                  hyperMention = {
                    ...body,
                    modelLabel: modelMention.definition.label,
                    modelOptionId: modelMention.modelOption.id,
                    modelSource: modelMention.modelOption.source,
                  };
                } else if (displayName === "HyperAI" && !hyperMention) {
                  hyperMention = body;
                }
              });
            } else PostFollowerBody.push(body);
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
            if (!agentId || seenAgentIds.has(agentId)) return;
          
            seenAgentIds.add(agentId);
            agentMentions.push(agentId);
          } catch (error) {
            console.log("🚀 ~ processHtml ~ error processing agent mentions:", error);
          }
        });

        const blobToBase64 = function (url: string) {
          return fetch(url)
            .then(function (response) {
              return response.blob();
            })
            .then(function (blob) {
              var type = blob.type;
              var size = blob.size;
              return new Promise(function (resolve, reject) {
                const reader = new FileReader();
                reader.onerror = reject;
                reader.readAsDataURL(blob);
                reader.onloadend = function () {
                  return resolve(reader.result);
                };
              });
            });
        };

        // Convert images sequentially
        async function convertImages() {
          for (const imgTag of imgTags) {
            const src = imgTag.getAttribute("src");

            try {
              if (src?.startsWith("data:image")) {
                var newUrl = await base64ToFile(src, "image.png"); // Replace this with your async function logic
                // urlsArray.push(newUrl);

                if (src && !urlsArray.includes(src)) {
                  const filename = newUrl.substring(
                    newUrl.lastIndexOf("/") + 1
                  );
                  let urlToAdd: any = {
                    // TaskId: taskId,
                    urlString: newUrl,
                    title: filename,
                  };

                  urlsArray.push(src);
                  uniqueAnchorUrls.push(urlToAdd);
                }
                console.log("🚀 ~ convertImages ~ newUrl:", newUrl)
                await imgTag.setAttribute("src", newUrl);
              } else if (src?.startsWith("blob:")) {
                try {
                  // console.log("🚀 ~ file: TaskDetailComp.tsx:1160 ~ convertImages ~ src:", src)
                  const base64FromBlob = await blobToBase64(src);
                  // console.log("🚀 ~ file: TaskDetailComp.tsx:1161 ~ convertImages ~ base64FromBlob:", base64FromBlob)
                  const newUrl = await base64ToFile(
                    base64FromBlob as string,
                    "image.png"
                  ); // Replace this with your async function logic
                  // console.log("🚀 ~ file: TaskDetailComp.tsx:1166 ~ convertImages ~ newUrl:", newUrl)

                  if (src && !urlsArray.includes(src)) {
                    const filename = newUrl.substring(
                      newUrl.lastIndexOf("/") + 1
                    );
                    // console.log("🚀 ~ file: TaskDetailComp.tsx:1171 ~ convertImages ~ filename:", filename)
                    let urlToAdd: any = {
                      // TaskId: taskId,
                      urlString: newUrl,
                      title: filename,
                    };

                    urlsArray.push(src);
                    uniqueAnchorUrls.push(urlToAdd);
                  }
                  await imgTag.setAttribute("src", newUrl);
                  // console.log("🚀 ~ file: TaskDetailComp.tsx:1056 ~ returnnewPromise ~ doc:", doc)
                  // console.log("🚀 ~ file: TaskDetailComp.tsx:1198 ~ convertImages ~ imgTag:", imgTag)
                } catch (error) {
                  console.log(error);
                }
              }
            } catch (error) {
              console.log(error);
            } finally {
              callback && callback((prev) => prev + 1);
            }
          }
        }
        // console.log("imagesurl",urlsArray)
        convertImages().then(() => {
          anchorTags.forEach((anchor) => {
            // console.log("anchor", anchor);
            const title = anchor.innerText;
            const url = anchor.getAttribute("href");
            if (url && !urlsArray.includes(url)) {
              let urlToAdd: any = {
                // TaskId: taskId,
                urlString: url,
                title: title,
              };
              urlsArray.push(url);
              uniqueAnchorUrls.push(urlToAdd);
            }
          });
          const returnHtml: modifiedHtml = {
            html: doc.documentElement.outerHTML,
            urls: uniqueAnchorUrls,
            PostFollowerBody,
            agentMentions,
            relations: relatedTasks,
            hyperMention,
            imageMention
          };

          resolve(returnHtml);

          // return doc.documentElement.outerHTML
        });

        // Resolve the promise with the modified HTML
      } catch (error) {
        // Reject the promise if there's an error
        reject(error);
      }
    });
  }


export const uploadAttachmentsDescription = (
    attachments: any[] | undefined,
    // taskId:number,
    // descriptionId:any
  ) => {
    // =========================== handle incoming attachments + already uploaded attachments
    // missing source means it needs to be uploaded first *WE ARE CHANGING THAT NOW
    // NEW:
    //   1: We will append source from the deepest component, send it back in callbacl.
    //   2: In the parent uploading component, we will then send back the entire array,
    //   3: if an item doesn't have createdAt, it means its a new attachment.

    var AttachmentUrls: ICreateTaskUrl[] = [];
    console.log("🚀 ~ attachments:", attachments)
    
    if (attachments) {


     
      
        attachments.forEach((attch) => {
          console.log("🚀 ~ attachments.forEach ~ attch:", attch)
          if (attch?.file?.source && !attch.file.createTaskUploadId) {
            let urlToAdd: ICreateTaskUrl = {
              // TaskId: taskId,
              urlString: attch.file.source as string,
              Attachment: true,
              fileSize: measuredSizeNumber(attch.file.size),
              title: attch.file.name,
              attachmentType: attch.file.type,
            };
          
            AttachmentUrls.push(urlToAdd);
          }
        });

      
        console.log("🚀 ~ AttachmentUrls:", AttachmentUrls)
      
        }
    return { AttachmentUrls };
  };
