// HTPR-6254. A Mac attaches photos as HEIC. Every render site branched on
// `fileType.startsWith("image/")`, HEIC passed that, and the user got a broken
// image icon on a file that had uploaded fine. These cases pin the distinction
// the render sites actually need: not "is it a picture" but "will an <img> paint
// it". Getting HEIC wrong here puts the broken icon straight back.
import assert from "node:assert/strict";
import test from "node:test";

import { isBrowserRenderableImage } from "../src/lib/media/browserRenderableImage";

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
  // macOS Finder drag-and-drop hands over files with no declared type at all.
  assert.equal(isBrowserRenderableImage("", "IMG_0421.HEIC"), false);
  assert.equal(isBrowserRenderableImage("", "screenshot.png"), true);
  assert.equal(isBrowserRenderableImage(undefined, "screenshot.PNG"), true);
  assert.equal(isBrowserRenderableImage("application/octet-stream", "IMG_0421.heic"), false);
  assert.equal(isBrowserRenderableImage("application/octet-stream", "diagram.svg"), true);
});

test("a declared image MIME wins over a misleading name", () => {
  // The name is only consulted when the MIME says nothing useful, so a real
  // PNG named .heic still renders and a real HEIC named .png still does not.
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
