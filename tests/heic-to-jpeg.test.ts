import assert from "node:assert/strict";
import test from "node:test";

import {
  HEIC_JPEG_QUALITY,
  isHeicByFtypBrand,
  isHeicByMetadata,
  jpegFileName,
  needsHeicConversion,
  planUploadFile,
} from "../src/lib/media/heicToJpeg";

/** An ISO base-media header: 4 size bytes, "ftyp", then the major brand. */
function ftypHeader(brand: string, box = "ftyp"): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(12));
  bytes[3] = 12;
  for (let i = 0; i < 4; i++) bytes[4 + i] = box.charCodeAt(i);
  for (let i = 0; i < 4; i++) bytes[8 + i] = brand.charCodeAt(i);
  return bytes;
}

function fileOf(
  name: string,
  type: string,
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(3)),
): File {
  return new File([bytes], name, { type });
}

test("a declared HEIC or HEIF MIME type is converted, sequences included", () => {
  // These are what an iPhone and a Mac actually put on the drag, and they are
  // the whole reason the photo used to arrive unpaintable.
  for (const mime of [
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
  ]) {
    assert.equal(isHeicByMetadata(mime, "photo.bin"), true, mime);
  }
  assert.equal(isHeicByMetadata("IMAGE/HEIC; charset=binary", "p"), true);
});

test("a JPEG or PNG is left alone whatever it is named", () => {
  assert.equal(isHeicByMetadata("image/jpeg", "actually-called.heic"), false);
  assert.equal(isHeicByMetadata("image/png", "shot.png"), false);
  assert.equal(isHeicByMetadata("application/pdf", "report.heic"), false);
});

test("an empty MIME falls back to the extension", () => {
  // macOS Finder drags routinely arrive with type "", so the name is the only
  // signal left and it has to be enough.
  for (const ext of ["heic", "heics", "heif", "heifs", "hif"]) {
    assert.equal(isHeicByMetadata("", `IMG_0001.${ext.toUpperCase()}`), true, ext);
  }
  assert.equal(isHeicByMetadata("application/octet-stream", "IMG.heic"), true);
  assert.equal(isHeicByMetadata("", "IMG_0001.jpg"), false);
  assert.equal(isHeicByMetadata("", "IMG_0001"), false);
  // A dot in a folder name is not an extension.
  assert.equal(isHeicByMetadata("", "v1.2/photo"), false);
});

test("the ftyp brand identifies a HEIC that declares nothing at all", () => {
  for (const brand of ["heic", "heix", "mif1", "msf1", "hevc", "heif"]) {
    assert.equal(isHeicByFtypBrand(ftypHeader(brand)), true, brand);
  }
  // A real MP4 shares the ftyp box but not the brand, so it must not be swept in.
  assert.equal(isHeicByFtypBrand(ftypHeader("isom")), false);
  assert.equal(isHeicByFtypBrand(ftypHeader("heic", "moov")), false);
  assert.equal(isHeicByFtypBrand(new Uint8Array([0, 0, 0])), false);
});

test("the byte sniff runs only when the MIME and the name say nothing", async () => {
  const heicBytes = ftypHeader("heic");
  // No type, no extension: the bytes are all we have, and they answer.
  assert.equal(await needsHeicConversion(fileOf("IMG_0001", "", heicBytes)), true);
  // A named file has already answered, so its bytes are never read.
  assert.equal(await needsHeicConversion(fileOf("clip.mp4", "", heicBytes)), false);
  // A declared type has already answered too.
  assert.equal(await needsHeicConversion(fileOf("x", "image/png", heicBytes)), false);
});

test("a HEIC is uploaded as a JPEG named after the original", async () => {
  const converted = new Blob([new Uint8Array([9, 9, 9])], { type: "image/jpeg" });
  let seenQuality: number | undefined;

  const original = fileOf("IMG_4821.HEIC", "image/heic");
  const plan = await planUploadFile(original, {
    loadConverter: async () => ({
      default: async ({ quality }) => {
        seenQuality = quality;
        return converted;
      },
    }),
  });

  // HTPR-6264: the original is kept, byte for byte and under its own name, so
  // it is still what the attachment records and what the user downloads.
  assert.equal(plan.file, original);
  assert.equal(plan.file.name, "IMG_4821.HEIC");
  assert.equal(plan.file.type, "image/heic");

  assert.equal(plan.preview?.name, "IMG_4821.jpg");
  assert.equal(plan.preview?.type, "image/jpeg");
  assert.equal(plan.preview?.size, 3);
  assert.equal(seenQuality, HEIC_JPEG_QUALITY);
});

test("a live photo decoding to several frames uploads the first one", async () => {
  // heic2any returns an array for bursts and live photos. Passing that array
  // straight into a File would upload the string "[object Blob]".
  const frames = [
    new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
    new Blob([new Uint8Array([2, 2])], { type: "image/jpeg" }),
  ];
  const plan = await planUploadFile(fileOf("live.heic", "image/heic"), {
    loadConverter: async () => ({ default: async () => frames }),
  });

  assert.equal(plan.preview?.type, "image/jpeg");
  assert.equal(plan.preview?.size, 1);
});

test("a conversion that throws still uploads the original HEIC alone", async () => {
  // Failing the upload would be worse than the bug being fixed: the user could
  // no longer attach the photo at all. They get the HTPR-6254 download chip.
  const original = fileOf("IMG_9.heic", "image/heic");
  const plan = await planUploadFile(original, {
    loadConverter: async () => {
      throw new Error("libheif failed to load");
    },
  });

  assert.equal(plan.file, original);
  assert.equal(plan.file.name, "IMG_9.heic");
  // No preview means nothing is uploaded to derive a preview URL from, which is
  // what tells every render site to stay on the download chip.
  assert.equal(plan.preview, null);
});

test("a decoder returning nothing usable leaves the original unpaired", async () => {
  const original = fileOf("IMG_9.heic", "image/heic");
  const plan = await planUploadFile(original, {
    loadConverter: async () => ({ default: async () => new Blob([]) }),
  });
  assert.equal(plan.file, original);
  assert.equal(plan.preview, null);
});

test("a non-HEIC file is planned alone and never loads the decoder", async () => {
  const jpeg = fileOf("shot.jpg", "image/jpeg");
  const plan = await planUploadFile(jpeg, {
    loadConverter: async () => {
      throw new Error("the decoder must never be loaded for a JPEG");
    },
  });
  assert.equal(plan.file, jpeg);
  assert.equal(plan.preview, null);
});

test("the converted name keeps a dotted base and survives an odd original", () => {
  assert.equal(jpegFileName("IMG_0001.HEIC"), "IMG_0001.jpg");
  assert.equal(jpegFileName("holiday.2026.heic"), "holiday.2026.jpg");
  assert.equal(jpegFileName("noextension"), "noextension.jpg");
  assert.equal(jpegFileName(""), "photo.jpg");
});
