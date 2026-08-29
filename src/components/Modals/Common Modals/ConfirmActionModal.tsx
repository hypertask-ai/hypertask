import ConfirmDialog from "./ConfirmDialog";

type IProps = {
  content: string;
  header: string;
  confirmButtonContent: string;
  customClassName?: string;
  compact?: string;
  onTaskPage?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const ConfirmModal = ({
  content,
  confirmButtonContent,
  customClassName,
  loading,
  loadingLabel,
  confirmDisabled,
  onConfirm,
  onCancel,
}: IProps) => {
  return (
    <ConfirmDialog
      id="confirm-action-modal"
      message={content}
      confirmLabel={confirmButtonContent}
      loading={loading}
      loadingLabel={loadingLabel}
      confirmDisabled={confirmDisabled}
      className={customClassName}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
};

export default ConfirmModal;
