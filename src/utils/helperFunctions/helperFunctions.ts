
export { type ISplit, type InboxTabMeta, type InboxStructuredDataCompact, type InboxStructuredDataExpanded, type InboxQueryPayload, resolveInboxStructuredData, buildInboxQueryCache, expandInboxApiResponse, getInboxTabs } from "./inboxHelpers";
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

export function sortByPriorityAndRankingOrder(order: SortingOrder, tieBreakByRanking = true) {
  return function sortByPriorityAndRanking(a: any, b: any) {
    if (a.priority && !b.priority) {
      return -1;
    }
    if (!a.priority && b.priority) {
      return 1;
    }

    const final =
      order === "Ascending"
        ? (b.priority?.priority_index || 0) - (a.priority?.priority_index || 0)
        : (a.priority?.priority_index || 0) - (b.priority?.priority_index || 0);

    if (final === 0 && tieBreakByRanking) {
      return (a.ranking || "").localeCompare(b.ranking || "");
    }

    return final;
  };
}

export function sortBySizeAndRankingOrder(order: SortingOrder, tieBreakByRanking = true) {
  return function sortBySizeAndRanking(a: any, b: any) {
    if (a.estimate && !b.estimate) {
      return -1;
    }
    if (!a.estimate && b.estimate) {
      return 1;
    }

    const final =
      order === "Descending"
        ? (b.estimate?.estimate_index || 0) - (a.estimate?.estimate_index || 0)
        : (a.estimate?.estimate_index || 0) - (b.estimate?.estimate_index || 0);

    if (final === 0 && tieBreakByRanking) {
      return (a.ranking || "").localeCompare(b.ranking || "");
    }

    return final;
  };
}

export function sortByCreatedAtOrder(order: SortingOrder) {
  return function sortByCreatedAt(a: any, b: any) {
    if (!a.createdAt && b.createdAt) return -1;
    if (a.createdAt && !b.createdAt) return 1;
    if (!a.createdAt && !b.createdAt) return 0;

    const dateA = new Date(a.createdAt);
    const dateB = new Date(b.createdAt);

    const final =
      order === "Ascending"
        ? dateA.getTime() - dateB.getTime()
        : dateB.getTime() - dateA.getTime();
    return final;
  };
}


export function sortByUpdatedAtOrder(order: SortingOrder) {
  return function sortByUpdatedAt(a: any, b: any) {
    if (!a.updatedAt && b.updatedAt) return -1;
    if (a.updatedAt && !b.updatedAt) return 1;
    if (!a.updatedAt && !b.updatedAt) return 0;

    const dateA = new Date(a.updatedAt);
    const dateB = new Date(b.updatedAt);

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
    const hasDueDateA = !!a.dueDate;
    const hasDueDateB = !!b.dueDate;

    if (!hasDueDateA && hasDueDateB) return 1;
    if (hasDueDateA && !hasDueDateB) return -1;
    if (!hasDueDateA && !hasDueDateB) return 0;

    const dateA = new Date(a.dueDate).getTime();
    const dateB = new Date(b.dueDate).getTime();

    return order === "Ascending" ? dateA - dateB : dateB - dateA;
  };
}


export function isSameDay(dateA?: Date | undefined, dateB?: Date | undefined) {
  if (!dateA && !dateB) return true;

  if (!dateA || !dateB) return false;

  const dayA = new Date(dateA);
  const dayB = new Date(dateB);

  return (
    dayA.getUTCFullYear() === dayB.getUTCFullYear() &&
    dayA.getUTCMonth() === dayB.getUTCMonth() &&
    dayA.getUTCDate() === dayB.getUTCDate()
  );
}

export const comparatorForSortingMode = (
  mode: TBoardSortingViewMode,
  order: TBoardSortingViewOrder,
  tieBreakByRanking = true
): ((a: ITask, b: ITask) => number) | null => {
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


export const getCurrentProject = (_currentProject:IProject) => {
    if(!_currentProject) return 
      if (_currentProject.section) {
        let _sections: ISection[] = []
        let focusontask :ITask|null=null;
        const sectionsReturned = getActiveColumnsViewFromProject(_currentProject)?.filter(x=>x.visibility)??[]

        for (var i = 0; i < sectionsReturned.length; i++) {
          const section = sectionsReturned[i];
          var filterItems:ITask[];
          if (_currentProject.tasks!==undefined && _currentProject.tasks!==null ) {
            filterItems = _currentProject?.tasks.filter((item: ITask) => item.sectionId === section.id)

            let itemsToSort = returnSortedItems(filterItems, _currentProject)
         

          if (itemsToSort.length>0 && focusontask===null) focusontask=itemsToSort[0];
            _sections.push({ wipLimit: section.wipLimit, section_title: section.section_title,sectionId:section.id, visibility:section.visibility?section.visibility:true, items: itemsToSort, id: section.id })
          }
        }
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
      const tempDivElement = new window.DOMParser().parseFromString(html, "text/html").body;

      return tempDivElement.textContent || tempDivElement.innerText || "";
    }
   
}

export function getParamsFromString(requestString:string){
    const queryString = requestString.split('?')[1];

      
      const queryParams: QueryParams = {};
    if (queryString) {
        const keyValuePairs = queryString.split('&');
      
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
  const elementRect = activeElement.getBoundingClientRect();
  const elementBottom = elementRect.bottom;

  const distanceToBottom = window.innerHeight - elementBottom;

  const threshold = (window.innerHeight * thresholdPercentage) / 100;
  if (distanceToBottom < threshold) {
    activeElement.scrollIntoView({behavior:"smooth",block:"center" })
  }
}



export function scrollToCenterIfNearTop(activeElement:HTMLElement, thresholdPercentage = 2) {
  const elementRect = activeElement.getBoundingClientRect();
  const elementTop = elementRect.top;

  const distanceToTop = elementTop;

  const threshold = (window.innerHeight * thresholdPercentage) / 100;

  if (distanceToTop < threshold) {
    const scrollPosition = elementRect.top - window.innerHeight / 2 + elementRect.height / 2;

    activeElement.scrollIntoView({behavior:"smooth", block:"center"})

  }
}
export function scrollToCenterIfNear(activeElement: HTMLElement, thresholdPercentage = 24): void {
  const elementRect = activeElement.getBoundingClientRect();

  const distanceToLeft = elementRect.left;
  const distanceToRight = window.innerWidth - elementRect.right;

  const threshold = (window.innerWidth * thresholdPercentage) / 100;

  if (distanceToLeft < threshold || distanceToRight < threshold) {
    console.log("scrolling to center")
    activeElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
}


export function convertTimestampToDate(timestamp: number): Date {
  return new Date(timestamp * 1000);
}

export function calculateRemainingTime (subscribedAt:Date){
  const currentDate: Date = new Date();
  const months:number = (getMonthDifference(
    subscribedAt, currentDate)
  );
  console.log("🚀 ~ calculateRemainingTime ~ 12-months:", 11-months)
  return 11-months
}


function getMonthDifference(startDate:Date, endDate:Date) {
  return (
    endDate.getMonth() -
    startDate.getMonth() +
    12 * (endDate.getFullYear() - startDate.getFullYear())
  );
}


export const isImage = (file: File): boolean => {
  return isBrowserRenderableImage(file.type, file.name);
};

export const processFiles = async (files: FileList, startingId: number) => {
    const  newFileItems: FileItem[] = await Promise.all(
      Array.from(files).map(async (original, index) => {
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
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
}

import { getFileTypeFromUrl, IMAGE_FALLBACK_MIME } from "./getFileTypeFromUrl";
export { getFileTypeFromUrl };

export const getFileTypeFromBase64 = (base64: string): string | null => {
  const matches = base64.match(/^data:(.+?);base64,/);
  return matches ? matches[1] : null;
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
  const milliseconds = timestamp * 1000;

  const date = new Date(milliseconds);

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
    const capturedArgs = args;

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
      
        const anyPElement = div.querySelector('p');
        if (anyPElement) {
            return anyPElement;
        }
    }
    return null;
}


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


export function throttle<T extends (...args: any[]) => void>(func: T, wait: number) {
  let waiting = false;
  const preventKeys =["ArrowDown", "ArrowUp","ArrowLeft","ArrowRight",  "Tab"]
  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    const notCtrlR = (args[0].ctrlKey && args[0].keyCode!==82)
    const modKey = args[0] && args[0].keyCode
    if (modKey === 16 || modKey === 17 || modKey === 18 || modKey === 91 || modKey === 93) return
    if (waiting) {
      return;
    }
    if (returnIfModalOrInputActive()) return
    
    waiting = true;

    setTimeout(() => {
      func.apply(this, args);
      waiting = false;
    },args[0].key==="g"?0: wait);
  };
}


export function getRandomElement(array:any[]) {
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

export function cleanTitle(title:string) {
  return title.replace(/[^a-zA-Z]/g, '').toLowerCase();
 }
export function getSequentialLetters(title:string) {
  const cleanedTitle = cleanTitle(title);
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
    (key, value) => (typeof value === "bigint" ? parseInt(value.toString()) : value)
  );
};


export function returnIfModalOrInputActive(exludeModal = false) {
  const classNamesToReturnFrom = [
    "modal-open",
    "ProseMirror ProseMirror-focused",
    "backdrop",
    undefined,
  ];
  const isInputFocused = [
    "input",
    "textarea",
    "textbox",
    "ProseMirror",
  ].includes((document.activeElement as HTMLElement)?.tagName?.toLowerCase());
  const isInsideTipTap = Boolean(
    document.activeElement?.closest(".ProseMirror")
  );

  const isInsideChatWindow = Boolean(
    document.activeElement?.closest(".chatwindow")
  );
  const modalOpenOrCarouselExists =
    document.querySelector(".modal") ||
    document.getElementById("carousel-container");
  const tipTapClassName: string = "tiptap ProseMirror ProseMirror-focused";

  const activeElementConditions =
    document?.activeElement?.role === "dialog" ||
    document?.activeElement?.id === "modalButtons" ||
    document.activeElement?.tagName === "INPUT" ||
    document.activeElement?.id === "htc" ||
    document.activeElement?.id === "boardManager";

  const isModalOpen = document.getElementsByClassName("modal show").length > 0;

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

export const shouldShowTrialModal = (user: any): boolean => {
  if (!user || !user.UserSetting) return false;

  const joinedAt = new Date(user.joinedAt);
  const now = new Date();
  const differenceInMilliseconds = now.getTime() - joinedAt.getTime();
  const fourteenDaysInMilliseconds = 14 * 24 * 60 * 60 * 1000;
  
  return !user.UserSetting.trialStatus && differenceInMilliseconds >= fourteenDaysInMilliseconds;
};

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

export function isDeepEqual(obj1: any, obj2: any): any {
  if (obj1 === obj2) return true;

  if (obj1 === null || obj2 === null) return obj1 === obj2;

  if (typeof obj1 !== typeof obj2) return false;

  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) return false;
    
    return obj1.every((elem, index) => isDeepEqual(elem, obj2[index]));
  }

  if (typeof obj1 === "object" && typeof obj2 === "object") {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    if (!keys1.every(key => keys2.includes(key))) return false;

    return keys1.every(key => isDeepEqual(obj1[key], obj2[key]));
  }

  return obj1 === obj2;
}

export const processImagesForHyperMention = async (htmlText: string, attachments: any) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText || "", "text/html");
    const imgTags = doc.querySelectorAll("img");
    let processedAttachments: { fileName: string, url: string, mimeType: string }[] = [];
    let countBase64 = 0;

    for (const img of imgTags) {
      const url = img.src;
      if (url.startsWith("https://files.hypertask.app")) {
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
