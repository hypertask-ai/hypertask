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
import {
  getMediaPasteDropPlugin,
  isEmbeddableMediaFile,
} from "../src/components/RTE/Extensions/resizableMedia/mediaPasteDropPlugin/mediaPasteDropPlugin";

const STORAGE = "https://files.example.com/attachments/1700_abc_IMG_4821.HEIC";

test("a HEIC resolves to the JPEG copy stored beside it", () => {
  assert.equal(
    heicPreviewUrl(STORAGE, "image/heic", "IMG_4821.HEIC"),
    `${STORAGE}${HEIC_PREVIEW_SUFFIX}`,
  );
  assert.equal(heicPreviewKey("attachments/k"), "attachments/k.preview.jpg");
});

test("a Mac photo with no MIME type at all still resolves by name", () => {
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
  assert.equal(heicPreviewUrl(preview, "image/heic", "IMG.HEIC"), null);
});

test("a URL carrying a query or fragment is left alone rather than guessed at", () => {
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
  assert.ok(STORAGE.endsWith(".HEIC"));
});

test("previews do not count against the files-at-once limit", () => {
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

  assert.match(
    getDirectUploadSizeError([
      ...withPreviews,
      { name: "one-too-many.jpg", size: 10, type: "image/jpeg" },
    ]) ?? "",
    /maximum of/,
  );
});

test("a pasted HEIC with no MIME type is embedded rather than dropped", () => {
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
  assert.equal(
    isEmbeddableMediaFile(
      new File([new Uint8Array(1)], "IMG.heic", { type: "image/heic" }),
    ),
    true,
  );
});

test("a HEIC exposed only through clipboard files is handled and inserted", async () => {
  const example = new File([new Uint8Array(1)], "example.heic", { type: "" });
  let prevented = false;
  let uploadStarted = false;
  let uploadedFile: File | undefined;
  let insertedNode: {
    type: { name: string };
    attrs: Record<string, unknown>;
    nodeSize: number;
  } | undefined;
  const transaction = {
    replaceSelectionWith(node: typeof insertedNode) {
      insertedNode = node;
      return transaction;
    },
    doc: {
      descendants(callback: (node: typeof insertedNode, pos: number) => void) {
        callback(insertedNode, 0);
      },
    },
    setNodeMarkup(_pos: number, _type: unknown, attrs: Record<string, unknown>) {
      if (insertedNode) insertedNode.attrs = attrs;
    },
  };
  const view = {
    state: {
      schema: {
        nodes: {
          resizableMedia: {
            create: (attrs: Record<string, unknown>) => ({
              type: { name: "resizableMedia" },
              attrs,
              nodeSize: 1,
            }),
          },
        },
      },
      tr: transaction,
    },
    dispatch() {},
  };
  const event = {
    clipboardData: {
      items: [] as unknown as DataTransferItemList,
      files: [example] as unknown as FileList,
    },
    preventDefault() {
      prevented = true;
    },
  };
  let finishUpload: () => void;
  const uploadFinished = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  const plugin = getMediaPasteDropPlugin({
    onUploadStart() {
      uploadStarted = true;
    },
    onUploadEnd() {
      finishUpload();
    },
    async uploadFn(file: File) {
      uploadedFile = file;
      return STORAGE;
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const handled = plugin.props.handlePaste?.call(
      plugin,
      view as never,
      event as unknown as ClipboardEvent,
      undefined as never,
    );

    assert.equal(handled, true);
    assert.equal(prevented, true);
    assert.equal(uploadStarted, true);
    assert.equal(insertedNode?.attrs["media-type"], "img");
    assert.equal(insertedNode?.attrs.isLoading, true);
    await uploadFinished;
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(uploadedFile, example);
  assert.equal(insertedNode?.attrs.src, STORAGE);
  assert.equal(insertedNode?.attrs.originalSrc, null);
  assert.equal(insertedNode?.attrs.isLoading, false);
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
