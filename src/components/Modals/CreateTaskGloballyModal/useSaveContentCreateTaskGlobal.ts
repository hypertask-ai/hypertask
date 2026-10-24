import { IAttachment, ICreateTaskUrl, IUrl, modifiedHtml, THyperMention } from "@/models/model";
import { measuredSizeNumber } from "@/lib/attachments/measuredSize";
import { resolveAiModelMention } from "@/lib/aiModelOptions";
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
        console.log("🚀 ~ returnnewPromise ~ anchorTags:", anchorTags)

        const spanElements = doc.querySelectorAll('span[data-label="task"]');
        const relatedTasks :{uniqueIndex: string, projectId: string}[]=[]

        spanElements.forEach((spanElement) => {
          const aElement = doc.createElement("a");
          const projectid = spanElement.getAttribute("projectId");
          console.log("🚀 ~ spanElements.forEach ~ projectid:", projectid);
          const index = spanElement.getAttribute("uniqueIndex");
          console.log("🚀 ~ spanElements.forEach ~ index:", index);
          aElement.innerHTML = spanElement.innerHTML;
          aElement.setAttribute(
            "href",
            `/detail/project-${projectid}/${index}`
          );
          for (const attribute of spanElement.attributes) {
            aElement.setAttribute(attribute.name, attribute.value);
          }

          spanElement.replaceWith(aElement);

          const url = aElement.getAttribute("href");
          const title = aElement.innerHTML;
          if (url && !urlsArray.includes(url)) {
            let urlToAdd: any = {
              urlString: url,
              title: title,
            };


            relatedTasks.push({
              uniqueIndex: index!,
              projectId: projectid!
            })
            urlsArray.push(url);
            uniqueAnchorUrls.push(urlToAdd);
          }
        });

        const userspans = doc.querySelectorAll('[data-label^="name"]');

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
  
            if (userid === hyperAiId) {
              const hyperMentionSpans = doc.querySelectorAll(
                `[data-label="name-${hyperAiId}"]`
              );
  
              hyperMentionSpans.forEach((span) => {
                if (span.closest("blockquote")) return;
                const displayName = span.getAttribute("data-id");
                const modelMention = resolveAiModelMention(displayName);
                if (modelMention) {
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

        async function convertImages() {
          for (const imgTag of imgTags) {
            const src = imgTag.getAttribute("src");

            try {
              if (src?.startsWith("data:image")) {
                var newUrl = await base64ToFile(src, "image.png");

                if (src && !urlsArray.includes(src)) {
                  const filename = newUrl.substring(
                    newUrl.lastIndexOf("/") + 1
                  );
                  let urlToAdd: any = {
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
                  const base64FromBlob = await blobToBase64(src);
                  const newUrl = await base64ToFile(
                    base64FromBlob as string,
                    "image.png"
                  );

                  if (src && !urlsArray.includes(src)) {
                    const filename = newUrl.substring(
                      newUrl.lastIndexOf("/") + 1
                    );
                    let urlToAdd: any = {
                      urlString: newUrl,
                      title: filename,
                    };

                    urlsArray.push(src);
                    uniqueAnchorUrls.push(urlToAdd);
                  }
                  await imgTag.setAttribute("src", newUrl);
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
        convertImages().then(() => {
          anchorTags.forEach((anchor) => {
            const title = anchor.innerText;
            const url = anchor.getAttribute("href");
            if (url && !urlsArray.includes(url)) {
              let urlToAdd: any = {
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
          };

          resolve(returnHtml);
        });
      } catch (error) {
        reject(error);
      }
    });
  }


export const uploadAttachmentsDescription = (
    attachments: any[] | undefined,
  ) => {
    var AttachmentUrls: ICreateTaskUrl[] = [];
    console.log("🚀 ~ attachments:", attachments)
    
    if (attachments) {


     
      
        attachments.forEach((attch) => {
          console.log("🚀 ~ attachments.forEach ~ attch:", attch)
          if (attch?.file?.source && !attch.file.createTaskUploadId) {
            let urlToAdd: ICreateTaskUrl = {
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
