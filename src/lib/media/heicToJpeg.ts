
export const HEIC_JPEG_QUALITY = 0.9;

const HEIC_MIME = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const HEIC_EXTENSION = new Set(["heic", "heics", "heif", "heifs", "hif"]);

const UNINFORMATIVE_MIME = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

const HEIC_FTYP_BRAND = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "heif",
]);

const FTYP_SNIFF_BYTES = 12;

function normalizeMime(mimeType?: string | null): string {
  return (mimeType ?? "").trim().toLowerCase().split(";")[0];
}

function extensionOf(fileName?: string | null): string {
  if (!fileName) return "";
  const path = fileName.split(/[?#]/)[0];
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");
  if (lastDot < 0 || lastDot < lastSlash) return "";
  return path.slice(lastDot + 1).toLowerCase();
}

export function isHeicByMetadata(
  mimeType?: string | null,
  fileName?: string | null,
): boolean {
  const mime = normalizeMime(mimeType);
  if (HEIC_MIME.has(mime)) return true;

  if (!UNINFORMATIVE_MIME.has(mime)) return false;
  return HEIC_EXTENSION.has(extensionOf(fileName));
}

export function isHeicByFtypBrand(header: ArrayBuffer | Uint8Array): boolean {
  const bytes =
    header instanceof Uint8Array ? header : new Uint8Array(header);
  if (bytes.length < FTYP_SNIFF_BYTES) return false;

  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));

  if (ascii(4, 8) !== "ftyp") return false;
  return HEIC_FTYP_BRAND.has(ascii(8, 12).toLowerCase());
}

export async function needsHeicConversion(file: File): Promise<boolean> {
  if (isHeicByMetadata(file.type, file.name)) return true;

  if (!UNINFORMATIVE_MIME.has(normalizeMime(file.type))) return false;
  if (extensionOf(file.name)) return false;

  try {
    const header = await file.slice(0, FTYP_SNIFF_BYTES).arrayBuffer();
    return isHeicByFtypBrand(header);
  } catch {
    return false;
  }
}

export function jpegFileName(fileName: string): string {
  const trimmed = fileName.trim() || "photo";
  const lastDot = trimmed.lastIndexOf(".");
  const lastSlash = trimmed.lastIndexOf("/");
  const base = lastDot > 0 && lastDot > lastSlash ? trimmed.slice(0, lastDot) : trimmed;
  return `${base || "photo"}.jpg`;
}

type Heic2AnyModule = {
  default: (options: {
    blob: Blob;
    toType?: string;
    quality?: number;
  }) => Promise<Blob | Blob[]>;
};

type PrepareUploadOptions = {
  loadConverter?: () => Promise<Heic2AnyModule>;
};

const loadHeic2Any = () =>
  import("heic2any") as unknown as Promise<Heic2AnyModule>;

export async function convertHeicToJpeg(
  file: File,
  { loadConverter = loadHeic2Any }: PrepareUploadOptions = {},
): Promise<File | null> {
  if (!(await needsHeicConversion(file))) return null;

  try {
    const { default: heic2any } = await loadConverter();
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: HEIC_JPEG_QUALITY,
    });

    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob || blob.size === 0) return null;

    return new File([blob], jpegFileName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch (error) {
    console.warn("[heic] conversion failed, keeping only the original", error);
    return null;
  }
}

export type UploadPlan = {
  file: File;
  preview: File | null;
};

export async function planUploadFile(
  file: File,
  options: PrepareUploadOptions = {},
): Promise<UploadPlan> {
  const cached = planCache.get(file);
  if (cached) return cached;

  const plan = convertHeicToJpeg(file, options).then((preview) => {
    if (preview) settledPreviews.set(file, preview);
    return { file, preview };
  });
  planCache.set(file, plan);
  return plan;
}

const planCache = new WeakMap<File, Promise<UploadPlan>>();

export async function planUploadFiles(files: File[]): Promise<UploadPlan[]> {
  return Promise.all(files.map((file) => planUploadFile(file)));
}

export function settledPreviewFor(file: File): File | null {
  return settledPreviews.get(file) ?? null;
}

const settledPreviews = new WeakMap<File, File>();

export function previewOrOriginal(plan: UploadPlan): File {
  return plan.preview ?? plan.file;
}
