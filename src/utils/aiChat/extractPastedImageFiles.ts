export function extractPastedImageFiles(
  items: DataTransferItemList | DataTransferItem[] | undefined
): File[] {
  return Array.from(items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
