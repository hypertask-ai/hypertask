// The gallery's remove handler is optional by design: the comment and
// description composers mount ImageGallery with handleRemove={null} because
// their previews are read-only. Calling it unguarded turned every failed
// upload into an unhandled rejection — SingleFileInputPreview's catch handler
// calls back into this handler — which left the composer wedged until a cache
// clear (HTPR-5521, duplicate HTPR-5519).
type UploadedFile = { file: { name?: string } };

type RemoveHandlerOptions = {
  mode: "others" | "Creating task";
  setUploadedFiles: (updater: (prev: UploadedFile[]) => UploadedFile[]) => void;
  handleRemove?: ((fileName: string) => void) | null;
};

export function createRemoveHandler({
  mode,
  setUploadedFiles,
  handleRemove,
}: RemoveHandlerOptions) {
  return (fileName: string) => {
    if (mode === "Creating task") {
      setUploadedFiles((prev) => prev.filter((x) => x?.file?.name !== fileName));
    }
    handleRemove?.(fileName);
  };
}

export default createRemoveHandler;
