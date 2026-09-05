import assert from "node:assert/strict";
import test from "node:test";
import { extractPastedImageFiles } from "./extractPastedImageFiles";

function makeItem(kind: string, type: string, file: File | null): DataTransferItem {
  return { kind, type, getAsFile: () => file } as DataTransferItem;
}

test("keeps only file items with an image MIME type", () => {
  const image = new File(["x"], "pasted.png", { type: "image/png" });
  const items = [
    makeItem("file", "image/png", image),
    makeItem("string", "text/plain", null),
    makeItem("file", "application/pdf", new File(["x"], "doc.pdf", { type: "application/pdf" })),
  ];

  assert.deepEqual(extractPastedImageFiles(items), [image]);
});

test("returns an empty array when nothing was pasted", () => {
  assert.deepEqual(extractPastedImageFiles(undefined), []);
});
