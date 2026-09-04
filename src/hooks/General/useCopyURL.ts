import toast from "react-hot-toast";
import { writeTextToClipboard } from "@/lib/utils/clipboard";

type UseCopyURLOptions = {
  plainTextOnly?: boolean;
};

// Rich (HTML + plain) copy with graceful degradation. The ClipboardItem/HTML
// path is unsupported on many mobile browsers and throws; when it does we fall
// back to copying the plain URL so the button never silently does nothing.
const writeRichToClipboard = async (
  html: string,
  text: string
): Promise<"rich" | "text" | false> => {
  try {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.write === "function" &&
      typeof ClipboardItem !== "undefined"
    ) {
      const clipboardItem = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([clipboardItem]);
      return "rich";
    }
  } catch (err) {
    console.error("clipboard.write (rich) failed, falling back to text:", err);
  }

  const ok = await writeTextToClipboard(text);
  return ok ? "text" : false;
};

const useCopyURL = ({ plainTextOnly = false }: UseCopyURLOptions = {}) => {
  const baseURL =
    process.env.NEXT_PUBLIC_BASEURL || "https://app.hypertask.ai";
  const copyTaskURL = async (
    uniqueIndex: number | undefined,
    projectId: number | undefined
  ): Promise<boolean> => {
    if (!uniqueIndex || !projectId) {
      toast.error("Error copying URL");
      return false;
    }
    const ok = await writeTextToClipboard(
      `${baseURL}/detail/project-${projectId}/${uniqueIndex}`
    );
    if (ok) toast(`Private share link (URL only) copied to clipboard`);
    else toast.error("Error copying URL");
    return ok;
  };

  const copyTaskFormattedURL = async (
    taskTitle: string,
    ticketnumber: string,
    uniqueIndex: number | undefined,
    projectId: number | undefined
  ): Promise<boolean> => {
    if (!uniqueIndex || !projectId) {
      toast.error("Error copying URL");
      return false;
    }
    const url = `${baseURL}/detail/project-${projectId}/${uniqueIndex}`;
    const formattedLinkText = `${ticketnumber.toUpperCase()} | ${taskTitle}`;
    const htmlContent = `<a href="${url}" class="task-link" title="${taskTitle}">${formattedLinkText}</a>`;
    if (plainTextOnly) {
      const ok = await writeTextToClipboard(`${formattedLinkText} | ${url}`);
      if (ok)
        toast(`Private share link (Title + URL) copied to clipboard`);
      else toast.error("Error copying link");
      return ok;
    }
    const result = await writeRichToClipboard(htmlContent, url);
    if (result === "rich")
      toast(`Private share link (Title + URL) copied to clipboard`);
    else if (result === "text")
      toast(`Private share link (URL only) copied to clipboard`);
    else toast.error("Error copying link");
    return result !== false;
  };

  const copySharedTaskURL = async (sharedId: string): Promise<boolean> => {
    if (!sharedId) {
      toast.error("Error copying URL");
      return false;
    }
    const ok = await writeTextToClipboard(`${baseURL}/share?id=${sharedId}`);
    if (ok) toast(`Public share link (URL only) copied to clipboard`);
    else toast.error("Error copying URL");
    return ok;
  };

  const copySharedTaskFormattedURL = async (
    sharedId: string,
    taskTitle: string,
    ticketnumber: string
  ): Promise<boolean> => {
    if (!sharedId) {
      toast.error("Error copying URL");
      return false;
    }
    const url = `${baseURL}/share?id=${sharedId}`;
    const formattedLinkText = `${ticketnumber.toUpperCase()} | ${taskTitle}`;
    const htmlContent = `<a href="${url}" class="task-link" title="${taskTitle}">${formattedLinkText}</a>`;
    if (plainTextOnly) {
      const ok = await writeTextToClipboard(`${formattedLinkText} | ${url}`);
      if (ok)
        toast(`Public share link (Title + URL) copied to clipboard`);
      else toast.error("Error copying link");
      return ok;
    }
    const result = await writeRichToClipboard(htmlContent, url);
    if (result === "rich")
      toast(`Public share link (Title + URL) copied to clipboard`);
    else if (result === "text")
      toast(`Public share link (URL only) copied to clipboard`);
    else toast.error("Error copying link");
    return result !== false;
  };

  const copyTitleAndTicketNumber = async (
    title: string,
    ticketNumber: string
  ): Promise<boolean> => {
    const ok = await writeTextToClipboard(
      `${ticketNumber.toUpperCase()} | ${title}`
    );
    if (ok) toast(`Task ID and title copied to clipboard`);
    else toast.error("Error copying");
    return ok;
  };

  const copyTicketNumber = async (ticketNumber: string): Promise<boolean> => {
    const ok = await writeTextToClipboard(`${ticketNumber.toUpperCase()}`);
    if (ok) toast(`Task ID copied to clipboard`);
    else toast.error("Error copying");
    return ok;
  };

  return {
    copyTaskURL,
    copyTaskFormattedURL,
    copySharedTaskFormattedURL,
    copySharedTaskURL,
    copyTitleAndTicketNumber,
    copyTicketNumber,
  };
};

export default useCopyURL;
