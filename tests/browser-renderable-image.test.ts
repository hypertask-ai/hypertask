import assert from "node:assert/strict";
import test from "node:test";

import {
  isBrowserRenderableImage,
  isUnrenderableImage,
} from "../src/lib/media/browserRenderableImage";

test("browsers paint the ordinary web image formats", () => {
  for (const mime of [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
    "image/svg+xml",
  ]) {
    assert.equal(isBrowserRenderableImage(mime, "photo"), true, mime);
  }
});

test("HEIC and HEIF are not renderable, so they get the file tile", () => {
  assert.equal(isBrowserRenderableImage("image/heic", "IMG_0421.heic"), false);
  assert.equal(isBrowserRenderableImage("image/heif", "IMG_0421.heif"), false);
  assert.equal(isBrowserRenderableImage("image/heic-sequence", "live.heics"), false);
});

test("TIFF is an image no browser paints either", () => {
  assert.equal(isBrowserRenderableImage("image/tiff", "scan.tiff"), false);
});

test("an empty MIME falls back to the extension", () => {
  assert.equal(isBrowserRenderableImage("", "IMG_0421.HEIC"), false);
  assert.equal(isBrowserRenderableImage("", "screenshot.png"), true);
  assert.equal(isBrowserRenderableImage(undefined, "screenshot.PNG"), true);
  assert.equal(isBrowserRenderableImage("application/octet-stream", "IMG_0421.heic"), false);
  assert.equal(isBrowserRenderableImage("application/octet-stream", "diagram.svg"), true);
});

test("a declared image MIME wins over a misleading name", () => {
  assert.equal(isBrowserRenderableImage("image/png", "IMG_0421.heic"), true);
  assert.equal(isBrowserRenderableImage("image/heic", "IMG_0421.png"), false);
});

test("non-images and unknown types are never rendered as images", () => {
  assert.equal(isBrowserRenderableImage("application/pdf", "spec.pdf"), false);
  assert.equal(isBrowserRenderableImage("video/mp4", "clip.mp4"), false);
  assert.equal(isBrowserRenderableImage("", "notes.txt"), false);
  assert.equal(isBrowserRenderableImage("", undefined), false);
});

test("MIME parameters and casing do not defeat the match", () => {
  assert.equal(isBrowserRenderableImage("IMAGE/PNG", "a.png"), true);
  assert.equal(isBrowserRenderableImage("image/jpeg; charset=binary", "a.jpg"), true);
});

test("an image no browser paints earns the download card", () => {
  assert.equal(isUnrenderableImage("image/heic", "IMG_0421.heic"), true);
  assert.equal(isUnrenderableImage("image/heif", "IMG_0421.heif"), true);
  assert.equal(isUnrenderableImage("image/tiff", "scan.tiff"), true);
  assert.equal(isUnrenderableImage("IMAGE/HEIC", "IMG_0421.heic"), true);
});

test("a HEIC the browser declined to type is still caught", () => {
  assert.equal(isUnrenderableImage("", "autumn_1440x960.heic"), true);
  assert.equal(isUnrenderableImage("application/octet-stream", "IMG_0421.HEIC"), true);
  assert.equal(isUnrenderableImage("application/octet-stream", "live.heics"), true);
});

test("renderable images and non-images never take the download card", () => {
  assert.equal(isUnrenderableImage("image/png", "shot.png"), false);
  assert.equal(isUnrenderableImage("", "shot.png"), false);
  assert.equal(isUnrenderableImage("application/pdf", "spec.pdf"), false);
  assert.equal(isUnrenderableImage("video/mp4", "clip.mp4"), false);
  assert.equal(isUnrenderableImage("", "receipt"), false);
  assert.equal(isUnrenderableImage("application/octet-stream", "archive.zip"), false);
});
