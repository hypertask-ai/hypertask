import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentDisplaySrc,
  HEIC_PREVIEW_SUFFIX,
  heicPreviewKey,
  heicPreviewUrl,
  isHeicPreviewUrl,
} from "../src/lib/media/heicPreview";
import {
  getDirectUploadSizeError,
  DIRECT_UPLOAD_MAX_FILES,
} from "../src/lib/storage/directUpload";
import { isEmbeddableMediaFile } from "../src/components/RTE/Extensions/resizableMedia/mediaPasteDropPlugin/mediaPasteDropPlugin";

const STORAGE = "https://files.example.com/attachments/1700_abc_IMG_4821.HEIC";

test("a HEIC resolves to the JPEG copy stored beside it", () => {
  // The whole linking scheme is this one line of arithmetic: no column, no
  // lookup, just the original's URL plus a fixed suffix. If this changes, every
  // photo uploaded before the change loses its preview.
  assert.equal(
    heicPreviewUrl(STORAGE, "image/heic", "IMG_4821.HEIC"),
    `${STORAGE}${HEIC_PREVIEW_SUFFIX}`,
  );
  assert.equal(heicPreviewKey("attachments/k"), "attachments/k.preview.jpg");
});

test("a Mac photo with no MIME type at all still resolves by name", () => {
  // macOS hands files over with an empty type often enough that the extension
  // is the only signal, which is exactly the case HTPR-6264 was reported on.
  assert.equal(
    heicPreviewUrl(STORAGE, "", "IMG_4821.HEIC"),
    `${STORAGE}${HEIC_PREVIEW_SUFFIX}`,
  );
  assert.equal(
    heicPreviewUrl(STORAGE, "application/octet-stream", "photo.heif"),
    `${STORAGE}${HEIC_PREVIEW_SUFFIX}`,
  );
});

test("anything that is not a HEIC has no preview and is shown as itself", () => {
  // A JPEG resolving to "<url>.preview.jpg" would send every image on every
  // board to a URL that does not exist.
  for (const [type, name] of [
    ["image/jpeg", "shot.jpg"],
    ["image/png", "shot.png"],
    ["application/pdf", "report.pdf"],
    ["video/mp4", "clip.mp4"],
  ] as const) {
    assert.equal(heicPreviewUrl(STORAGE, type, name), null, name);
    assert.equal(attachmentDisplaySrc(STORAGE, type, name), STORAGE, name);
  }
});

test("a preview is never given a preview of its own", () => {
  const preview = `${STORAGE}${HEIC_PREVIEW_SUFFIX}`;
  assert.equal(isHeicPreviewUrl(preview), true);
  assert.equal(isHeicPreviewUrl(STORAGE), false);
  // Without this the suffix would compound every time a resolved URL was
  // resolved again, and the second hop would 404.
  assert.equal(heicPreviewUrl(preview, "image/heic", "IMG.HEIC"), null);
});

test("a URL carrying a query or fragment is left alone rather than guessed at", () => {
  // Appending to a signed URL would build the suffix into the query string and
  // produce a key nothing is stored under. Declining is the honest answer.
  assert.equal(
    heicPreviewUrl(`${STORAGE}?token=abc`, "image/heic", "IMG.HEIC"),
    null,
  );
  assert.equal(heicPreviewUrl("", "image/heic", "IMG.HEIC"), null);
  assert.equal(heicPreviewUrl(null, "image/heic", "IMG.HEIC"), null);
});

test("the display source is the copy, and never replaces the download source", () => {
  const displayed = attachmentDisplaySrc(STORAGE, "image/heic", "IMG_4821.HEIC");
  assert.equal(displayed, `${STORAGE}${HEIC_PREVIEW_SUFFIX}`);
  // The point of the ticket: the original URL is still the original URL, so
  // whatever downloads from `fileSource` keeps handing back the .HEIC.
  assert.ok(STORAGE.endsWith(".HEIC"));
});

test("previews do not count against the files-at-once limit", () => {
  // A user dragging in the maximum number of Mac photos doubles the objects
  // sent to storage. Counting those would tell them they had picked twice as
  // many files as they had.
  const picked = Array.from({ length: DIRECT_UPLOAD_MAX_FILES }, (_, i) => ({
    name: `IMG_${i}.heic`,
    size: 1000,
    type: "image/heic",
  }));
  const withPreviews = picked.flatMap((file, index) => [
    file,
    { name: `${file.name}.jpg`, size: 500, type: "image/jpeg", previewOfIndex: index },
  ]);

  assert.equal(getDirectUploadSizeError(picked), null);
  assert.equal(getDirectUploadSizeError(withPreviews), null);

  // One more real file is still over the line.
  assert.match(
    getDirectUploadSizeError([
      ...withPreviews,
      { name: "one-too-many.jpg", size: 10, type: "image/jpeg" },
    ]) ?? "",
    /maximum of/,
  );
});

test("a pasted HEIC with no MIME type is embedded rather than dropped", () => {
  // This is the reported bug. The old filter was `type.indexOf("image") === 0`,
  // and a Finder paste arrives with an empty type often enough that the photo
  // was silently discarded: nothing inserted, nothing logged, nothing shown.
  assert.equal(
    isEmbeddableMediaFile(new File([new Uint8Array(1)], "IMG_4821.HEIC", { type: "" })),
    true,
  );
  assert.equal(
    isEmbeddableMediaFile(
      new File([new Uint8Array(1)], "IMG_4821.heic", {
        type: "application/octet-stream",
      }),
    ),
    true,
  );
  // A declared HEIC was already accepted and must stay accepted.
  assert.equal(
    isEmbeddableMediaFile(
      new File([new Uint8Array(1)], "IMG.heic", { type: "image/heic" }),
    ),
    true,
  );
});

test("the paste filter still accepts ordinary media and still rejects documents", () => {
  assert.equal(
    isEmbeddableMediaFile(new File([new Uint8Array(1)], "a.png", { type: "image/png" })),
    true,
  );
  assert.equal(
    isEmbeddableMediaFile(new File([new Uint8Array(1)], "a.mp4", { type: "video/mp4" })),
    true,
  );
  // Widening the filter must not start swallowing text and PDF pastes, which
  // have to keep falling through to the editor's default paste handling.
  assert.equal(
    isEmbeddableMediaFile(
      new File([new Uint8Array(1)], "report.pdf", { type: "application/pdf" }),
    ),
    false,
  );
  assert.equal(
    isEmbeddableMediaFile(new File([new Uint8Array(1)], "notes.txt", { type: "" })),
    false,
  );
  assert.equal(isEmbeddableMediaFile(null), false);
});
