
export { type ISplit, type InboxTabMeta, type InboxStructuredDataCompact, type InboxStructuredDataExpanded, type InboxQueryPayload, resolveInboxStructuredData, buildInboxQueryCache, expandInboxApiResponse, getInboxTabs } from "./inboxHelpers";
// reorder them whenever it works for now
// reorder them whenever it works for now
import { IProject, ISection, ITask, preSelectParamPricing, QueryParams } from "@/models/model";
import { getPricingSettingsPath } from "@/lib/pricingSettingsPaths";
import sortByStringParam from "../sortByParam";
import Resizer from "react-image-file-resizer";
import { SortingOrder } from "@prisma/client";
import { getActiveColumnsViewFromProject, getActiveSortingModeFromProject, getActiveSortingOrderFromProject, getActiveSortingStackFromProject } from "./Views/ViewsHelperFunctions";
import type { FileItem } from "@/components/Common/AttachmentsUpload";
import { isBrowserRenderableImage } from "@/lib/media/browserRenderableImage";
import { planUploadFile } from "@/lib/media/heicToJpeg";


import { TBoardSortingViewMode, TBoardSortingViewOrder } from "@/models/Views/model";



// ponytail: tieBreakByRanking defaults to true so every existing caller keeps today's behaviour.
// Stacked sorting passes false for non-final levels, because ranking is unique per task: left on,
// it always returns non-zero and the secondary/tertiary levels would never get a say.
export function sortByPriorityAndRankingOrder(order: SortingOrder, tieBreakByRanking = true) {
  return function sortByPriorityAndRanking(a: any, b: any) {
    if (a.priority && !b.priority) {
      return -1; // a comes first
    }
    if (!a.priority && b.priority) {
      return 1; // b comes first
    }

    // Both have priority or no priority, compare priority_index
    const final =
      order === "Ascending"
        ? (b.priority?.priority_index || 0) - (a.priority?.priority_index || 0)
        : (a.priority?.priority_index || 0) - (b.priority?.priority_index || 0);

    // If estimate_index is the same, compare by ranking
    if (final === 0 && tieBreakByRanking) {
      return (a.ranking || "").localeCompare(b.ranking || "");
    }

    return final;
  };
}

export function sortBySizeAndRankingOrder(order: SortingOrder, tieBreakByRanking = true) {
  return function sortBySizeAndRanking(a: any, b: any) {
    if (a.estimate && !b.estimate) {
      return -1; // a comes first
    }
    if (!a.estimate && b.estimate) {
      return 1; // b comes first
    }

    // Both have estimate or no estimate, compare estimate_index
    const final =
      order === "Descending"
        ? (b.estimate?.estimate_index || 0) - (a.estimate?.estimate_index || 0)
        : (a.estimate?.estimate_index || 0) - (b.estimate?.estimate_index || 0);

    // If estimate_index is the same, compare by ranking
    if (final === 0 && tieBreakByRanking) {
      return (a.ranking || "").localeCompare(b.ranking || "");
    }

    return final;
  };
}

export function sortByCreatedAtOrder(order: SortingOrder) {
  return function sortByCreatedAt(a: any, b: any) {
    // If 'createdAt' is missing in 'a' but exists in 'b', 'b' comes first
    if (!a.createdAt && b.createdAt) return -1;
    // If 'createdAt' is missing in 'b' but exists in 'a', 'a' comes first
    if (a.createdAt && !b.createdAt) return 1;
    // If neither has a 'createdAt', maintain original order
    if (!a.createdAt && !b.createdAt) return 0;

    // Both have 'createdAt', sort from oldest to latest
    const dateA = new Date(a.createdAt);
    const dateB = new Date(b.createdAt);

    //depends on order
    const final =
      order === "Ascending"
        ? dateA.getTime() - dateB.getTime()
        : dateB.getTime() - dateA.getTime();
    return final;
  };
}


export function sortByUpdatedAtOrder(order: SortingOrder) {
  return function sortByUpdatedAt(a: any, b: any) {
    // If 'createdAt' is missing in 'a' but exists in 'b', 'b' comes first
    if (!a.updatedAt && b.updatedAt) return -1;
    // If 'createdAt' is missing in 'b' but exists in 'a', 'a' comes first
    if (a.updatedAt && !b.updatedAt) return 1;
    // If neither has a 'createdAt', maintain original order
    if (!a.updatedAt && !b.updatedAt) return 0;

    // Both have 'createdAt', sort from oldest to latest
    const dateA = new Date(a.updatedAt);
    const dateB = new Date(b.updatedAt);

    //depends on order
    const final =
      order === "Ascending"
        ? dateA.getTime() - dateB.getTime()
        : dateB.getTime() - dateA.getTime();
    return final;
  };
}

export function sortBySectionChangedAtOrder(order: SortingOrder) {
  return function sortBySectionChangedAt(a: ITask, b: ITask) {
    const dateA = a.sectionChangedAt ?? a.createdAt;
    const dateB = b.sectionChangedAt ?? b.createdAt;

    if (!dateA && dateB) return 1;
    if (dateA && !dateB) return -1;
    if (!dateA && !dateB) return 0;

    const timestampA = new Date(dateA!).getTime();
    const timestampB = new Date(dateB!).getTime();
    return order === "Ascending"
      ? timestampA - timestampB
      : timestampB - timestampA;
  };
}

export function sortByLastCommentAtOrder(order: SortingOrder) {
  return function sortByLastCommentAt(a: ITask, b: ITask) {
    const dateA = a.lastCommentAt ?? a.createdAt;
    const dateB = b.lastCommentAt ?? b.createdAt;

    if (!dateA && dateB) return 1;
    if (dateA && !dateB) return -1;
    if (!dateA && !dateB) return 0;

    const timestampA = new Date(dateA!).getTime();
    const timestampB = new Date(dateB!).getTime();
    return order === "Ascending"
      ? timestampA - timestampB
      : timestampB - timestampA;
  };
}

export function sortByAssigneeOrder(order: SortingOrder) {
  return function sortByAssignee(a: ITask, b: ITask) {
    // Agent first, then user: an agent assignment also carries its owner in `user`, and the card
    // renders the agent, so keying on the user would sort by a name nobody can see.
    const assigneeA = a.assignees?.[0]?.agent?.displayName || a.assignees?.[0]?.user?.displayName;
    const assigneeB = b.assignees?.[0]?.agent?.displayName || b.assignees?.[0]?.user?.displayName;

    if (!assigneeA && assigneeB) return 1;
    if (assigneeA && !assigneeB) return -1;
    if (!assigneeA && !assigneeB) return 0;

    const result = assigneeA!.localeCompare(assigneeB!);
    return order === "Descending" ? -result : result;
  };
}

export function sortByTitleOrder(order: SortingOrder) {
  return function sortByTitle(a: ITask, b: ITask) {
    const result = (a.title || "").localeCompare(b.title || "");
    return order === "Descending" ? -result : result;
  };
}

export function sortByTicketNumberOrder(order: SortingOrder) {
  return function sortByTicketNumber(a: ITask, b: ITask) {
    return order === "Descending"
      ? b.uniqueIndex - a.uniqueIndex
      : a.uniqueIndex - b.uniqueIndex;
  };
}

export function sortByDueDateOrder(order: SortingOrder) {
  return function sortByDueDate(a: any, b: any) {
    // console.log("🚀 ~ sortByDueDate ~ b:", b);
    // console.log("🚀 ~ sortByDueDate ~ a:", a);

    // Items without a dueDate should always be placed last
    const hasDueDateA = !!a.dueDate;
    const hasDueDateB = !!b.dueDate;

    if (!hasDueDateA && hasDueDateB) return 1;
    if (hasDueDateA && !hasDueDateB) return -1;
    if (!hasDueDateA && !hasDueDateB) return 0;

    // Both have dueDate, sort based on order
    const dateA = new Date(a.dueDate).getTime();
    const dateB = new Date(b.dueDate).getTime();

    return order === "Ascending" ? dateA - dateB : dateB - dateA;
  };
}


// Helper function to compare if two dates are on the same day
export function isSameDay(dateA?: Date | undefined, dateB?: Date | undefined) {
  if (!dateA && !dateB) return true;

  // If one of the dates is missing, tasks should not be moveable
  if (!dateA || !dateB) return false;

  // If both dates exist, check if they are on the same day
  const dayA = new Date(dateA);
  const dayB = new Date(dateB);

  return (
    dayA.getUTCFullYear() === dayB.getUTCFullYear() &&
    dayA.getUTCMonth() === dayB.getUTCMonth() &&
    dayA.getUTCDate() === dayB.getUTCDate()
  );
}

// ================= enter a project and get back the correct sorting according to the set view mode
export const comparatorForSortingMode = (
  mode: TBoardSortingViewMode,
  order: TBoardSortingViewOrder,
  tieBreakByRanking = true
): ((a: ITask, b: ITask) => number) | null => {
  // Durations grow as timestamps age, so their order is the inverse of timestamp order.
  const invertOrder = (value: TBoardSortingViewOrder): TBoardSortingViewOrder =>
    value === "Ascending" ? "Descending" : "Ascending"

  switch (mode) {
    case "Priority":
      return sortByPriorityAndRankingOrder(order, tieBreakByRanking)
    case "DueDate":
      return sortByDueDateOrder(order)
    case "Size":
      return sortBySizeAndRankingOrder(order, tieBreakByRanking)
    case "CreatedAt":
      return sortByCreatedAtOrder(order)
    case "UpdatedAt":
      return sortByUpdatedAtOrder(order)
    case "SectionChangedAt":
      return sortBySectionChangedAtOrder(order)
    case "LastCommentAt":
      return sortByLastCommentAtOrder(order)
    case "TimeInColumn":
      return sortBySectionChangedAtOrder(invertOrder(order))
    case "TimeOnBoard":
      return sortByCreatedAtOrder(invertOrder(order))
    case "TimeWithoutComment":
      return sortByLastCommentAtOrder(invertOrder(order))
    case "Assignee":
      return sortByAssigneeOrder(order)
    case "Title":
      return sortByTitleOrder(order)
    case "TicketNumber":
      return sortByTicketNumberOrder(order)
    case "Manual":
    default:
      return null
  }
}

export const buildSortComparator = (
  levels: { mode: TBoardSortingViewMode; order: TBoardSortingViewOrder }[]
): ((a: ITask, b: ITask) => number) | null => {
  const comparators = levels
    // Only the final level may fall back to ranking; earlier levels must be able to
    // report a tie so the level below them decides.
    .map(({ mode, order }, index) => comparatorForSortingMode(mode, order, index === levels.length - 1))
    .filter((comparator): comparator is (a: ITask, b: ITask) => number => comparator !== null)

  if (!comparators.length) return null

  return (a, b) => {
    for (const comparator of comparators) {
      const result = comparator(a, b)
      if (result !== 0) return result
    }
    return 0
  }
}

export const returnSortedItems = (filterItems:ITask[], project:IProject) => {
  // check if the board has a user applied view. otherwise the default view.
  // user_project_views basically has ALL the user_project_views.
  // We know that since we're only getting one from backend, we are safe to check the 0 index. but add type safety anyways
  const boardAppliedSortingModeView = getActiveSortingModeFromProject(project)
  const boardAppliedSortingOrderView = getActiveSortingOrderFromProject(project)

  const itemsToSort = sortByStringParam(filterItems, 'ranking')
  const levels = [
    { mode: boardAppliedSortingModeView, order: boardAppliedSortingOrderView },
    ...getActiveSortingStackFromProject(project),
  ]
  const cmp = buildSortComparator(levels)
  if (!cmp) return itemsToSort
  return itemsToSort.slice().sort(cmp)
}

// Usage:

export const getCurrentProject = (_currentProject:IProject) => {
    if(!_currentProject) return 
      if (_currentProject.section) {
        let _sections: ISection[] = []
        let focusontask :ITask|null=null;
        // const sectionsReturned = syncChangesForColumns(_currentProject)?.filter(x=>x.visibility)??[] //upsertBoardColumnsViewAndReturn(_currentProject)?.filter(x=>x.visibility)??[]
        const sectionsReturned = getActiveColumnsViewFromProject(_currentProject)?.filter(x=>x.visibility)??[] //upsertBoardColumnsViewAndReturn(_currentProject)?.filter(x=>x.visibility)??[]

        // console.log("🚀 ~ getCurrentProject ~ sectionsReturned:", sectionsReturned)
        for (var i = 0; i < sectionsReturned.length; i++) {
          const section = sectionsReturned[i];
          // console.log("🚀 ~ file: Homepage.tsx:125 ~ getCurrentProject ~ section:", section)
          var filterItems:ITask[];
          if (_currentProject.tasks!==undefined && _currentProject.tasks!==null ) {
            filterItems = _currentProject?.tasks.filter((item: ITask) => item.sectionId === section.id)
            // const response = await commentsGetCountByTask(taskIds)

            let itemsToSort = returnSortedItems(filterItems, _currentProject)
         

          // To get First Task Details
          if (itemsToSort.length>0 && focusontask===null) focusontask=itemsToSort[0];
            _sections.push({ section_title: section.section_title,sectionId:section.id, visibility:section.visibility?section.visibility:true, items: itemsToSort, id: section.id })
          }
        }
        // console.log("🚀 ~ getCurrentProject ~ _sections:", _sections)
        return {_sections: _sections, firstTask:focusontask}
      }
      return []
    
  }


  export function deepCopy<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
  
    if (Array.isArray(obj)) {
      const copy: any[] = [];
      for (let i = 0; i < obj.length; i++) {
        copy[i] = deepCopy(obj[i]);
      }
      return copy as T;
    }
  
    const copy: Record<string, any> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        copy[key] = deepCopy(obj[key]);
      }
    }
    return copy as T;
  }

  export const fetcher = (url:string) => fetch(url).then((res) => res.json());


export  const convertToPlain=(html:string)=>{
    if (typeof window!=="undefined"){

      // Create a new div element
      var tempDivElement = document.createElement("div");

      // Set the HTML content with the given value
      tempDivElement.innerHTML = html;

      // Retrieve the text property of the element 
      return tempDivElement.textContent || tempDivElement.innerText || "";
    }
   
}

export function getParamsFromString(requestString:string){
    const queryString = requestString.split('?')[1];

      
      const queryParams: QueryParams = {};
    if (queryString) {
        // Split the query string into individual key-value pairs
        const keyValuePairs = queryString.split('&');
      
        // Iterate through the key-value pairs and store them in the object
        keyValuePairs.forEach((pair) => {
          const [key, value] = pair.split('=');
          queryParams[key] = decodeURIComponent(value);
        });
      }
    return queryParams
}


export function detectDevice(userAgent:any) {
  if (userAgent.includes('Linux') && userAgent.includes('X11')) {
    return 'Desktop (Linux)';
  } else if (userAgent.includes('Windows NT')) {
    return 'Desktop (Windows)';
  } else if (userAgent.includes('Mac OS X')) {
    return 'Desktop (Mac)';
  } else if (
    userAgent.includes('Mobile') ||
    userAgent.includes('Android') ||
    userAgent.includes('iOS') ||
    userAgent.includes('iPhone') ||
    userAgent.includes('iPad') ||
    userAgent.includes('Windows Phone')
  ) {
    return 'Mobile';
  } else {
    return 'Unknown';
  }
}

export const emptyDescription = `<html><head></head><body><p></p></body></html>`


export function scrollToCenterIfNearBottom(activeElement:HTMLElement, thresholdPercentage = 10) {
  // Calculate the position of the active element
  const elementRect = activeElement.getBoundingClientRect();
  const elementBottom = elementRect.bottom;

  // Calculate the distance from the bottom of the screen
  const distanceToBottom = window.innerHeight - elementBottom;

  // Calculate the dynamic threshold based on a percentage of the viewport height
  const threshold = (window.innerHeight * thresholdPercentage) / 100;
  // console.log("🚀 ~ scrollToCenterIfNearBottom ~ threshold:", threshold)
  // console.log("🚀 ~ scrollToCenterIfNearBottom ~ distanceToBottom:", distanceToBottom)
  // console.log("🚀 ~ scrollToCenterIfNearBottom ~ distanceToBottom < threshold:", distanceToBottom < threshold)
  // Check if the element is close to the bottom
  if (distanceToBottom < threshold) {
    // Calculate the desired scroll position to center the element
    // const scrollPosition = elementRect.top - window.innerHeight / 2 + elementRect.height / 2;
    // console.log("🚀 ~ file: helperFunctions.ts:136 ~ scrollToCenterIfNearBottom ~ scrollPosition:", scrollPosition)

    // Scroll to the desired position
    activeElement.scrollIntoView({behavior:"smooth",block:"center" })
  }
}



export function scrollToCenterIfNearTop(activeElement:HTMLElement, thresholdPercentage = 2) {
  // Calculate the position of the active element
  const elementRect = activeElement.getBoundingClientRect();
  const elementTop = elementRect.top;

  // Calculate the distance from the top of the screen
  const distanceToTop = elementTop;

  // Calculate the dynamic threshold based on a percentage of the viewport height
  const threshold = (window.innerHeight * thresholdPercentage) / 100;

  // Check if the element is close to the top
  if (distanceToTop < threshold) {
    // Calculate the desired scroll position to center the element
    const scrollPosition = elementRect.top - window.innerHeight / 2 + elementRect.height / 2;

    // Scroll to the desired position
    activeElement.scrollIntoView({behavior:"smooth", block:"center"})

  }
}
export function scrollToCenterIfNear(activeElement: HTMLElement, thresholdPercentage = 24): void {
  // Calculate the position of the active element
  const elementRect = activeElement.getBoundingClientRect();

  // Calculate the distance from both left and right edges
  const distanceToLeft = elementRect.left;
  const distanceToRight = window.innerWidth - elementRect.right;

  // Calculate the dynamic threshold based on a percentage of the viewport size
  const threshold = (window.innerWidth * thresholdPercentage) / 100;

  // Check if the element is close to either edge
  if (distanceToLeft < threshold || distanceToRight < threshold) {
    // Scroll to the desired position
    console.log("scrolling to center")
    activeElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
}


export function convertTimestampToDate(timestamp: number): Date {
  return new Date(timestamp * 1000); // Convert seconds to milliseconds
}

export function calculateRemainingTime (subscribedAt:Date){

  // User subscription date
  // const currentDate: Date = new Date('2024-12-01T11:00:25'); // Subscription started on Nov 29, 2023
  const currentDate: Date = new Date(); // Use the current date
  const months:number = (getMonthDifference(
    subscribedAt, currentDate)
  );
  //indexing for months in getMonthDifference is 0 [January]...and so on
  console.log("🚀 ~ calculateRemainingTime ~ 12-months:", 11-months)
  // const returnPriceId:string = yearlyPriceIds[13-months]
  return 11-months
}


function getMonthDifference(startDate:Date, endDate:Date) {
  return (
    endDate.getMonth() -
    startDate.getMonth() +
    12 * (endDate.getFullYear() - startDate.getFullYear())
  );
}


// HTPR-6254: this gates the pre-upload resize, which runs the file through a
// canvas. A canvas can only draw what the browser can decode, so handing it a
// HEIC from a Mac produced a WEBP of nothing, and worse, imageResizer's promise
// has no reject path, so a decode that never fires onload left the attach
// hanging forever. Only resize formats the browser can actually read; anything
// else uploads untouched, which is also what makes it downloadable later.
export const isImage = (file: File): boolean => {
  return isBrowserRenderableImage(file.type, file.name);
};

export const processFiles = async (files: FileList, startingId: number) => {
    const  newFileItems: FileItem[] = await Promise.all(
      Array.from(files).map(async (original, index) => {
        // HTPR-6264: a HEIC is decoded here, before anything else looks at it,
        // so the optimistic tile has a JPEG copy to paint. The file itself is
        // deliberately left alone: it is what gets uploaded, what the
        // attachment is named after and what the user downloads again later.
        // The decode is cached per file, so the upload layer reuses this one
        // rather than doing it a second time.
        const { file } = await planUploadFile(original);
        if (isImage(file)) {
          if (file.size / (1024 ** 2) > 2) {
            const resizedImage = await imageResizer(file);
            console.log("🚀 ~ Array.from ~ resizedImage:", resizedImage)
            return { id: startingId + index, file: resizedImage as File };

          }
          else {
            return { id: startingId + index, file: file as File };
          }
        } else {
          return { id: startingId + index, file };
        }
      })
    );
    return newFileItems
  }
/**
 *Function to crop an image file
 * Specifically for user profiles to be more rounded shaped.
 *
 * @param {File} file
 * @return {*}  {Promise<Blob>}
 */
export const cropToCircle = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = function (e) {
        const img = document.createElement("img");
        img.onload = function () {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Could not get canvas context"));
            return;
          }

          const size = Math.min(img.width, img.height);
          canvas.width = size;
          canvas.height = size;

          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();

          const offsetX = (img.width - size) / 2;
          const offsetY = (img.height - size) / 2;
          ctx.drawImage(img, -offsetX, -offsetY, img.width, img.height);

          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error("Canvas to Blob conversion failed"));
              return;
            }
            resolve(blob);
          }, "image/png");
        };
        img.onerror = () => reject(new Error("Image loading error"));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error("File reading error"));
      reader.readAsDataURL(file);
    });
};

export const convertFileToBase64 = (file: any) => {
    console.log("🚀 ~ convertFileToBase64 ~ file:", file)
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); // Returns the Base64 string
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file); // Start reading the file
    });
}

import { getFileTypeFromUrl, IMAGE_FALLBACK_MIME } from "./getFileTypeFromUrl";
export { getFileTypeFromUrl };

export const getFileTypeFromBase64 = (base64: string): string | null => {
  // Check if the string is a valid Base64 data URL
  const matches = base64.match(/^data:(.+?);base64,/);
  return matches ? matches[1] : null; // Returns MIME type (e.g., "image/png")
}

export const blobToBase64 = function (url: string) {
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


export async function imageResizer  (file:File)  {
  const resizeFile = (file:File) =>
  new Promise((resolve) => {
    Resizer.imageFileResizer(
      file,
      1600,
      900,
      "WEBP",
      100,
      0,
      (uri) => {
        resolve(uri);
      },
      "file"
    );
  });
  try {
      const image = await resizeFile(file);
      return image
      
      
    } catch (err) {
    }
}

export function convertTimestampToFormattedDate(timestamp: number): string {
  // Convert timestamp to milliseconds
  const milliseconds = timestamp * 1000;

  // Create a Date object using the timestamp
  const date = new Date(milliseconds);

  // Get the formatted date string (e.g., "January 3, 2024")
  const formattedDate = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return formattedDate;
}


export function getCurrencySymbol(locale: string, currency: string): string {
  return (0).toLocaleString(
    locale,
    {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }
  ).replace(/\d/g, '').trim();
}


export function debounce<T extends (...args: any[]) => any>(func: T, delay: number) {
  let timeoutId: NodeJS.Timeout;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    const context = this;
    const capturedArgs = args; // capture the current arguments

    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(context, capturedArgs), delay);
  };
}

export function debounceWithCancel<T extends (...args: any[]) => any>(
  func: T, 
  delay: number
): [T, () => void, () => void] {
  let timeoutId: NodeJS.Timeout | undefined;
  let pending:
    | { context: ThisParameterType<T>; args: Parameters<T> }
    | undefined;

  const invokePending = () => {
    if (!pending) return;
    const { context, args } = pending;
    pending = undefined;
    timeoutId = undefined;
    func.apply(context, args);
  };

  const debouncedFn = function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    pending = { context: this, args };
    clearTimeout(timeoutId);
    timeoutId = setTimeout(invokePending, delay);
  } as T;

  const cancel = () => {
    clearTimeout(timeoutId);
    timeoutId = undefined;
    pending = undefined;
  };

  const flush = () => {
    if (!pending) return;
    clearTimeout(timeoutId);
    invokePending();
  };

  return [debouncedFn, cancel, flush];
}
export function selectPElementWithDataPlaceholderInDiv(divId:string) {
    const div = document.getElementById(divId);
    if (div) {
        const pWithPlaceholder = div.querySelector('p[data-placeholder]');
        if (pWithPlaceholder) {
            return pWithPlaceholder;
        }
      
        //Updated it this way so that it adds to p even if there isnt a new line.
        const anyPElement = div.querySelector('p');
        if (anyPElement) {
            return anyPElement;
        }
    }
    return null;
}


// wed, feb 28 2024 at 14:37GMT
export function formatDateToGMT(date: Date) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
 
  const day = dayNames[date.getDay()];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes();
 
  let period = "AM";
  if (hours >= 12) {
     period = "PM";
     if (hours > 12) {
       hours -= 12;
     }
  } else if (hours === 0) {
     hours = 12;
  }
 
  const formattedHours = hours;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
 
  const formattedDate = `${day}, ${month} ${date.getDate()} ${year} at ${formattedHours}:${formattedMinutes} ${period}`;
 
  return formattedDate;
 }
 
const classNamesToReturnFrom = ["modal-open","ProseMirror ProseMirror-focused",undefined]


// Your debounce function
export function throttle<T extends (...args: any[]) => void>(func: T, wait: number) {
  let waiting = false;
  const preventKeys =["ArrowDown", "ArrowUp","ArrowLeft","ArrowRight",  "Tab"]
  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    const notCtrlR = (args[0].ctrlKey && args[0].keyCode!==82)
    // ponytail: a bare modifier keydown (Shift/Ctrl/Alt/Meta) must NOT open the throttle
    // window. The `waiting` flag is shared across keys, so a chord like Shift+F whose second
    // keydown (F) lands <wait ms after the Shift keydown gets swallowed by `if (waiting) return`.
    // That is PERT-35: "Shift+F only works on the second try" on fast keyboards. Modifier-only
    // keydowns match no shortcut here anyway, so skipping them is safe.
    const modKey = args[0] && args[0].keyCode
    if (modKey === 16 || modKey === 17 || modKey === 18 || modKey === 91 || modKey === 93) return
    if (waiting) {
      return;
    }
    if (returnIfModalOrInputActive()) return
    // if (args[0].shiftKey|| notCtrlR || args[0].key ==="ArrowUp" || args[0].altKey|| preventKeys.includes(args[0].key)) event?.preventDefault()
    
    waiting = true;

    setTimeout(() => {
      func.apply(this, args);
      waiting = false;
    },args[0].key==="g"?0: wait);
  };
}


// Function to get a random element from an array
export function getRandomElement(array:any[]) {
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}




// Function to clean the title by removing spaces and non-alphabetical characters
export function cleanTitle(title:string) {
  return title.replace(/[^a-zA-Z]/g, '').toLowerCase();
 }
// Function to generate a deterministic 4-letter identifier from the title
export function getSequentialLetters(title:string) {
  const cleanedTitle = cleanTitle(title);
  // Ensure there are at least 4 characters
  if (cleanedTitle.length < 4) {
    return "Not enough characters";
  }
  const words = title.match(/[a-zA-Z]+/g) ?? [];
  if (words.length > 1) {
    const first = words[0]!.slice(0, 2);
    const last = words[words.length - 1]!.slice(0, 4 - first.length);
    if (first.length + last.length === 4) return `${first}${last}`.toUpperCase();
  }
  return cleanedTitle.substring(0, 4).toUpperCase();
 }
 


export function getFromLocalStorage(key:string, defaultValue = undefined){
  const value = localStorage.getItem(key)
  return value ? JSON.parse(value) : defaultValue
}
export function setInLocalStorage(key:string, value?:any) {
  if (!key) {
    throw new Error("Key and value are required")
  }
  if (value) localStorage.setItem(key, JSON.stringify(value))
  else localStorage.removeItem(key)
}




export function removeFromLocalStorage(key:string) {
  if (!key) {
    throw new Error("Key is required")
  }
  localStorage.removeItem(key)
}

export const json = (param: any): any => {
  return JSON.stringify(
    param,
    (key, value) => (typeof value === "bigint" ? parseInt(value.toString()) : value) // return everything else unchanged
  );
};


/**
 * For making sure keydown operations do not conflict with other elements
 *
 * @export
 * @param {boolean} [exludeModal=false]
 * @return {*} 
 */
export function returnIfModalOrInputActive(exludeModal = false) {
  const classNamesToReturnFrom = [
    "modal-open",
    "ProseMirror ProseMirror-focused",
    "backdrop",
    undefined,
  ];
  // Check if the modal is open or if the carousel container exists
  const isInputFocused = [
    "input",
    "textarea",
    "textbox",
    "ProseMirror",
  ].includes((document.activeElement as HTMLElement)?.tagName?.toLowerCase());
  const isInsideTipTap = Boolean(
    document.activeElement?.closest(".ProseMirror")
  );

  // Check if the active element is a descendant of chatwindow
  const isInsideChatWindow = Boolean(
    document.activeElement?.closest(".chatwindow")
  );
  const modalOpenOrCarouselExists =
    document.querySelector(".modal") ||
    document.getElementById("carousel-container");
  const tipTapClassName: string = "tiptap ProseMirror ProseMirror-focused";

  // Check if the active element has certain roles or IDs
  const activeElementConditions =
    document?.activeElement?.role === "dialog" ||
    document?.activeElement?.id === "modalButtons" ||
    document.activeElement?.tagName === "INPUT" ||
    document.activeElement?.id === "htc" ||
    document.activeElement?.id === "boardManager";

  const isModalOpen = document.getElementsByClassName("modal show").length > 0;

  // Check if the active element's class name matches any in the array
  const classNameMatch = classNamesToReturnFrom.includes(
    document?.activeElement?.className
  );

  return (
    (exludeModal && modalOpenOrCarouselExists) ||
    activeElementConditions ||
    classNameMatch ||
    isInsideTipTap ||
    isInputFocused ||
    isModalOpen ||
    document.activeElement?.className === tipTapClassName ||
    isInsideChatWindow
  );
}

export const constructPricingPageUrl = (_currentProject:IProject, preSelect:preSelectParamPricing)=>{
  return getPricingSettingsPath(preSelect)
}

export const constructTrialPageURL = (_currentProject:IProject)=>{
  const baseURL = String(process.env.NEXT_PUBLIC_BASEURL)
  return `${baseURL}/trial-plan-confirmation?teamId=${_currentProject?.teamId}&totalSeats=${_currentProject?.team.totalSeats}&googleAccountId=${_currentProject?.team.googleAccountId}&stripe_customer_id=${_currentProject?.team.stripe_customer_id}&teamTitle=${_currentProject?.team.title}`
}

export  const checkFreemiumDuration = (userJoinedAt: Date) => {
    const joinedAt = new Date(userJoinedAt);
    const now = new Date();
    const differenceInMilliseconds = now.getTime() - joinedAt.getTime();

    const fourteenDaysInMilliseconds = 14 * 24 * 60 * 60 * 1000;

    const fourteenDaysPassed = differenceInMilliseconds >= fourteenDaysInMilliseconds;

    if (fourteenDaysPassed) return true;
    else return false;
  };

/**
 * Determines if a user should see the trial modal.
 * A user should see the trial modal if:
 * 1. They have not redeemed their trial (trialStatus is false)
 * 2. At least 14 days have passed since they joined
 * 
 * @param user - User object with UserSetting and joinedAt
 * @returns true if user should see trial modal, false otherwise
 */
export const shouldShowTrialModal = (user: any): boolean => {
  if (!user || !user.UserSetting) return false;

  const joinedAt = new Date(user.joinedAt);
  const now = new Date();
  const differenceInMilliseconds = now.getTime() - joinedAt.getTime();
  const fourteenDaysInMilliseconds = 14 * 24 * 60 * 60 * 1000;
  
  return !user.UserSetting.trialStatus && differenceInMilliseconds >= fourteenDaysInMilliseconds;
};

/** True if the user may open /trial (voluntary upgrade). Distinct from compelled flow in shouldShowTrialModal. */
export const canAccessTrialPage = (user: any): boolean => {
  if (!user || !user.UserSetting) return false;
  return !user.UserSetting.trialStatus;
};

export const getDaysLeftFreemium = (userJoinedAt: Date): number => {
  const fourteenDaysInMilliseconds = 14 * 24 * 60 * 60 * 1000;
  const joinedAt = new Date(userJoinedAt);
  const endOfFreemium = new Date(joinedAt.getTime() + fourteenDaysInMilliseconds);
  const now = new Date();
  const differenceInMilliseconds = endOfFreemium.getTime() - now.getTime();
  const oneDayInMilliseconds = 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil(differenceInMilliseconds / oneDayInMilliseconds);

  return daysLeft;
};

// export const isDeepEqual = (obj1: any, obj2: any) => {
//   if (obj1 === obj2) return true;
//   if (typeof obj1 !== "object" || typeof obj2 !== "object" || obj1 == null || obj2 == null) return false;

//   const keys1 = Object.keys(obj1);
//   const keys2 = Object.keys(obj2);

//   if (keys1.length !== keys2.length) return false;

//   for (let key of keys1) {
//       if (!keys2.includes(key)) return false;
//       if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
//           if (!isDeepEqual(obj1[key], obj2[key])) return false;
//       } else if (obj1[key] !== obj2[key]) {
//           return false;
//       }
//   }

//   return true;
// };

export function isDeepEqual(obj1: any, obj2: any): any {
  if (obj1 === obj2) return true;

  // Check if both are null
  if (obj1 === null || obj2 === null) return obj1 === obj2;

  // If types are different, objects are not equal
  if (typeof obj1 !== typeof obj2) return false;

  // Check for arrays
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) return false;
    
    return obj1.every((elem, index) => isDeepEqual(elem, obj2[index]));
  }

  // Check for objects
  if (typeof obj1 === "object" && typeof obj2 === "object") {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    // If objects don't have the same number of keys, they're not equal
    if (keys1.length !== keys2.length) return false;

    // Check if every key in obj1 is present in obj2
    if (!keys1.every(key => keys2.includes(key))) return false;

    // Recursively check all values
    return keys1.every(key => isDeepEqual(obj1[key], obj2[key]));
  }

  // For primitives and all other types, return strict equality
  return obj1 === obj2;
}

export const processImagesForHyperMention = async (htmlText: string, attachments: any) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText || "", "text/html");
    const imgTags = doc.querySelectorAll("img");
    let processedAttachments: { fileName: string, url: string, mimeType: string }[] = [];
    let countBase64 = 0;

    // Process inline images
    for (const img of imgTags) {
      const url = img.src;
      if (url.startsWith("https://files.hypertask.app")) {
        // Same CORS trap as the task writer: only the URL travels on, so read the MIME
        // type off the file name rather than fetching the file (HTPR-4735).
        const mimeType = getFileTypeFromUrl(url, IMAGE_FALLBACK_MIME);
        const fileName = url.substring(url.lastIndexOf("/") + 1);
        processedAttachments.push({ fileName, url, mimeType });
      } else {
        const mimeType = getFileTypeFromBase64(url) ?? "application/octet-stream";
        processedAttachments.push({
          fileName: `unknown-base64-${countBase64}`,
          url,
          mimeType,
        });
        countBase64++;
      }
    }

    for (const { file } of attachments) {
      const dataUrl = (await convertFileToBase64(file)) as string;
      const mimeType =
        file.type ||
        getFileTypeFromBase64(dataUrl) ||
        "application/octet-stream";
      processedAttachments.push({
        fileName: file.name,
        url: dataUrl,
        mimeType,
      });
    }
    return processedAttachments;
}

/** Returns true if focus is on an AI Chat button, link, or inside the AI Chat UI (sidebar or popover) */
export const isAIChatElementFocused = () => {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return (
    Boolean(el.closest('.chatwindow')) ||
    Boolean(el.closest('.bg-ai-chat')) ||
    (el.id?.startsWith?.('ai-chat-header-') ?? false) ||
    (el.id?.startsWith?.('ai-chat-message-') ?? false)
  )
}
