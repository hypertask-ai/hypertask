type WarmEditor = { destroy: () => void };

let warmed = false;

const buildHeadlessEditor = async (): Promise<WarmEditor> => {
  const [{ Editor }, { createTiptapExtensions }] = await Promise.all([
    import("@tiptap/core"),
    import("./Tiptap"),
  ]);
  return new Editor({
    extensions: createTiptapExtensions({
      mode: "read-edit-description",
      placeholderText: "",
      localWritingAssistanceEnabled: () => false,
    }),
    content: "<p></p>",
    element: null,
  });
};

/**
 * HTPR-6853: the first ticket open pays a one-time ~100 ms cost building the
 * ProseMirror schema and plugin set. Build one throwaway headless editor with
 * the real extension set at idle so that cost is already paid. Runs once per
 * page load and never touches the DOM or the user's editors.
 */
export async function warmTiptapEditor(build: () => Promise<WarmEditor> = buildHeadlessEditor) {
  if (warmed) return;
  warmed = true;
  try {
    (await build()).destroy();
  } catch {
    // Warming is best effort.
  }
}
