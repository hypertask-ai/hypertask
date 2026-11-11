import { startCreateTaskUpload } from "@/lib/createTaskAttachmentUploads";

type ScreenshotInput = { source?: string | null; url?: string | null; name?: string | null; fileName?: string | null; type?: string | null; mimeType?: string | null } | File | undefined;
export type ScreenshotFile = { url?: string; fileName?: string; mimeType?: string };
const HOSTED_RE = /^https?:\/\//i;

export async function hostedScreenshotFiles(files: ScreenshotInput[]): Promise<ScreenshotFile[]> {
  const hosted: ScreenshotFile[] = [];
  const uploaded = new Map<string, string>();
  for (const entry of files) {
    if (!entry) continue;
    const file = entry as Exclude<ScreenshotInput, undefined>;
    const source = (file as { source?: string | null }).source ?? (file as { url?: string | null }).url ?? undefined;
    const fileName = (file as { name?: string | null }).name ?? (file as { fileName?: string | null }).fileName ?? undefined;
    const mimeType = (file as { type?: string | null }).type ?? (file as { mimeType?: string | null }).mimeType ?? undefined;
    if (source && HOSTED_RE.test(source)) {
      hosted.push({ url: source, fileName, mimeType });
      continue;
    }
    const type = mimeType || (typeof File !== "undefined" && file instanceof File ? file.type : "");
    if (!type.startsWith("image/")) {
      hosted.push({ url: source ?? undefined, fileName, mimeType });
      continue;
    }
    const uploadable = (typeof File !== "undefined" && file instanceof File) ? file : await fileFromSource(source, fileName ?? "screenshot");
    if (!uploadable) {
      hosted.push({ url: source ?? undefined, fileName, mimeType });
      continue;
    }
    const key = source ?? uploadable.name;
    let url = uploaded.get(key);
    if (!url) {
      try {
        url = (await startCreateTaskUpload(uploadable).promise).url;
        uploaded.set(key, url);
      } catch {
        hosted.push({ url: source ?? undefined, fileName, mimeType });
        continue;
      }
    }
    hosted.push({ url, fileName, mimeType });
  }
  return hosted;
}

async function fileFromSource(source: string | undefined, name: string): Promise<File | null> {
  if (!source || typeof File === "undefined" || !/^(data|blob):/i.test(source)) return null;
  try {
    const blob = await (await fetch(source)).blob();
    return new File([blob], name, { type: blob.type || "image/png" });
  } catch {
    return null;
  }
}
