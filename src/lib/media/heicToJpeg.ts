/**
 * HEIC/HEIF to JPEG conversion, in the browser, before the bytes are uploaded.
 *
 * HTPR-6257: an iPhone or a Mac hands over photos as HEIC. No browser except
 * Safari decodes HEIF, so an uploaded HEIC painted a broken-image icon in the
 * comment body, the attachment tile, the gallery and the lightbox.
 * HTPR-6254 stopped the broken icon by showing a download chip instead, which
 * is honest but still not the photo.
 *
 * Uploads go browser-to-storage through a presigned PUT, so the server never
 * sees the bytes and cannot convert them, and `sharp`/`heic-convert` are not
 * installable on the current hosting. The only place the pixels exist is the
 * browser, so that is where the conversion happens: every upload path runs its
 * files through `planUploadFile` first, which pairs the untouched original with
 * an ordinary JPEG named `<original>.jpg`.
 *
 * HTPR-6264: that JPEG used to *replace* the original, which fixed every render
 * site by throwing away the file the user actually attached. Both are uploaded
 * now. `src/lib/media/heicPreview.ts` says where the copy lands and which of
 * the two a given surface should show.
 *
 * The decoder (libheif, ~1.4 MB) is behind a dynamic `import()`, so a user who
 * never attaches a HEIC never downloads it.
 */

/** JPEG quality for the converted photo. High enough to be indistinguishable. */
export const HEIC_JPEG_QUALITY = 0.9;

/** MIME types that mean "this is HEIF-family", including the sequence variants. */
const HEIC_MIME = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

/** Extensions used for the same formats, for files that arrive without a MIME. */
const HEIC_EXTENSION = new Set(["heic", "heics", "heif", "heifs", "hif"]);

/** MIME values a picker or a Finder drag produces when it has no opinion. */
const UNINFORMATIVE_MIME = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

/**
 * `ftyp` brands that identify a HEIF-family file. These are the major and
 * compatible brands ISO/IEC 23008-12 defines for still images and sequences.
 */
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

/** Bytes needed to read the `ftyp` box header and its major brand. */
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

/**
 * True when the MIME type or the file name already says HEIC/HEIF.
 *
 * This is the cheap answer. It is deliberately separate from the byte sniff so
 * the common case costs nothing: only a file that declares nothing useful is
 * worth reading off disk.
 */
export function isHeicByMetadata(
  mimeType?: string | null,
  fileName?: string | null,
): boolean {
  const mime = normalizeMime(mimeType);
  if (HEIC_MIME.has(mime)) return true;

  // A file that names a real, different image type is not a HEIC whatever it
  // is called, so only an uninformative MIME falls through to the extension.
  if (!UNINFORMATIVE_MIME.has(mime)) return false;
  return HEIC_EXTENSION.has(extensionOf(fileName));
}

/**
 * True when the first bytes of a file are an ISO base-media `ftyp` box whose
 * major brand is a HEIF one.
 *
 * macOS can hand over a photo with an empty MIME type and a name carrying no
 * extension at all, and then the bytes are the only evidence left. Layout:
 * 4 bytes big-endian box size, the literal "ftyp", then the 4-character major
 * brand.
 */
export function isHeicByFtypBrand(header: ArrayBuffer | Uint8Array): boolean {
  const bytes =
    header instanceof Uint8Array ? header : new Uint8Array(header);
  if (bytes.length < FTYP_SNIFF_BYTES) return false;

  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));

  if (ascii(4, 8) !== "ftyp") return false;
  return HEIC_FTYP_BRAND.has(ascii(8, 12).toLowerCase());
}

/**
 * Whether this file needs converting before it can be shown as a picture.
 *
 * Reads the first bytes only when the MIME and the name both say nothing, and
 * only when the file is not already recognisable as some other image format.
 */
export async function needsHeicConversion(file: File): Promise<boolean> {
  if (isHeicByMetadata(file.type, file.name)) return true;

  // Anything with a usable MIME or a known image extension has already
  // answered; sniffing it would be a pointless read.
  if (!UNINFORMATIVE_MIME.has(normalizeMime(file.type))) return false;
  if (extensionOf(file.name)) return false;

  try {
    const header = await file.slice(0, FTYP_SNIFF_BYTES).arrayBuffer();
    return isHeicByFtypBrand(header);
  } catch {
    return false;
  }
}

/** Replaces any extension on a file name with `.jpg`. */
export function jpegFileName(fileName: string): string {
  const trimmed = fileName.trim() || "photo";
  const lastDot = trimmed.lastIndexOf(".");
  const lastSlash = trimmed.lastIndexOf("/");
  const base = lastDot > 0 && lastDot > lastSlash ? trimmed.slice(0, lastDot) : trimmed;
  return `${base || "photo"}.jpg`;
}

/** The shape of the lazily imported decoder, kept narrow on purpose. */
type Heic2AnyModule = {
  default: (options: {
    blob: Blob;
    toType?: string;
    quality?: number;
  }) => Promise<Blob | Blob[]>;
};

type PrepareUploadOptions = {
  /**
   * Loads the decoder. Injectable so tests can drive the success and the
   * failure path without a real 1.4 MB wasm decode.
   */
  loadConverter?: () => Promise<Heic2AnyModule>;
};

const loadHeic2Any = () =>
  import("heic2any") as unknown as Promise<Heic2AnyModule>;

/**
 * Decodes a HEIC/HEIF file into a JPEG `File`, or returns null.
 *
 * Null means "there is no JPEG copy of this": the file was not a HEIC in the
 * first place, or the decoder threw, or it produced nothing. Callers treat all
 * three the same way, because the user-visible answer is the same in each case:
 * the original is all there is.
 */
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

    // A live photo or a burst decodes to one blob per frame. The first is the
    // still the user thinks they attached.
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

/**
 * One file the user picked, and what should actually be sent to storage for it.
 *
 * `file` is always exactly what the user chose, byte for byte, keeping its name
 * and its MIME type: that is what the attachment row records and what the
 * download button hands back. `preview` is the JPEG copy that every picture
 * surface paints instead, and is null whenever there is nothing to convert or
 * the conversion did not work out.
 */
export type UploadPlan = {
  file: File;
  preview: File | null;
};

/**
 * Decides what to upload for one picked file.
 *
 * HTPR-6264: this replaced "convert the HEIC and upload the JPEG instead"
 * (HTPR-6257), which fixed every render site by destroying the original. A Mac
 * photo now costs two objects in storage and keeps both properties: the raw
 * file is still downloadable, and the pixels are still paintable.
 */
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

/**
 * One decode per picked file, however many times it is planned.
 *
 * The same `File` object is planned at least twice on the attachment path: once
 * when it is picked, so the tray can show a thumbnail, and again in the upload
 * layer, which must not trust callers to have done it. libheif is a 1.4 MB wasm
 * decode of a multi-megabyte photo, so doing that a second time is seconds of
 * the user's time for a result we already have. Keyed weakly, so nothing is
 * held once the file is dropped.
 *
 * Keyed by the file object rather than by name and size, so two different
 * pictures that happen to match cannot be confused for one another.
 */
const planCache = new WeakMap<File, Promise<UploadPlan>>();

/** `planUploadFile` across a list, preserving order. */
export async function planUploadFiles(files: File[]): Promise<UploadPlan[]> {
  return Promise.all(files.map((file) => planUploadFile(file)));
}

/**
 * The already-decoded JPEG copy of `file`, if one has been made.
 *
 * Synchronous and never starts work: for render paths that have to answer
 * during a render and whose file has already been through `planUploadFile`.
 * Null covers "not a HEIC", "conversion failed" and "not planned yet" alike,
 * and every caller falls back to the original for all three.
 */
export function settledPreviewFor(file: File): File | null {
  return settledPreviews.get(file) ?? null;
}

const settledPreviews = new WeakMap<File, File>();

/**
 * The single file to show the user for a plan: the JPEG copy when there is one.
 *
 * For optimistic thumbnails and editor placeholders, which paint from an object
 * URL before anything has been uploaded and only ever have room for one image.
 */
export function previewOrOriginal(plan: UploadPlan): File {
  return plan.preview ?? plan.file;
}
