import { idToDeleteCommentAtom } from "@/store";
import axios from "axios";
import { useState } from "react";
import toast from "react-hot-toast";
import { useRecoilState } from "@/lib/state";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { Trash2 } from "lucide-react";

// Ctrl+K "delete comment" command. Routes through the shared palette ConfirmDialog
// (same as DeleteCommentById) instead of raw reactstrap Bootstrap buttons, so it
// matches the Ctrl+K style and inherits ConfirmDialog's safe Enter/Esc handling.
const DeleteMessage = ({ callback }: { callback: (id: number) => void }) => {
  const [deleteModal, setDeleteModal] = useState<boolean>(true);
  const [idToDelete] = useRecoilState(idToDeleteCommentAtom);
  const [loading, setLoading] = useState(false);

  const confirmDelete = async () => {
    if (loading || !idToDelete) return;
    setLoading(true);
    try {
      const response = await axios.post("/api/comments/deleteCommentById", {
        id: idToDelete,
      });
      if (response.status === 200) {
        setDeleteModal(false);
        callback(idToDelete);
        toast("Comment deleted succesfully");
        return;
      }
      if (response.status === 201) {
        toast("You can't delete this comment");
        setDeleteModal(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => setDeleteModal(false);

  if (!deleteModal) return null;

  return (
    <ConfirmDialog
      id="confirmDeleteMessage"
      icon={Trash2}
      message="Clicking confirm will delete this comment!"
      confirmLabel="Delete comment"
      loadingLabel="Deleting…"
      loading={loading}
      footerVerb="delete"
      onConfirm={() => void confirmDelete()}
      onCancel={handleCancel}
    />
  );
};

export default DeleteMessage;
