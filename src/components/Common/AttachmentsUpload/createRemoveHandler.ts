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
