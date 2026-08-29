import axios from "axios";
import { useState } from "react";
import toast from "react-hot-toast";
import { useRecoilState } from "@/lib/state";
import { idToDeleteCommentAtom } from "@/store";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { Trash2 } from "lucide-react";

const DeleteCommentById = (props:any) => {
  const [idToDelete , setIdToDelete] = useRecoilState(idToDeleteCommentAtom)
  const [deleteModal, setDeleteModal] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
 
  const confirmFollow = async () => {
    if (loading) return;
    setLoading(true);
    if(props){
        try {
          const response = await axios.post("/api/comments/deleteCommentById",{
              id:idToDelete
          } )
          if (response.status===200){
              setDeleteModal(false)
              // callback(idToDelete)
              props?.setShowCommentDeleteModal(false)
              props.callback(idToDelete!,"DELETE")
              // props?.setComments((comments:any) =>
              //          comments?.filter((comment:any) => String(comment.id) !== String(idToDelete))
              //       );
              toast("Comment deleted succesfully")
              return
          }
          if(response.status===201){
              toast("You can't delete this comment")
              props?.setShowCommentDeleteModal(false)
              setDeleteModal(false)
              return
          }
        } finally {
          setLoading(false);
        }
  
    }
    else{
        // toast("You can't delete this")
        props?.setShowCommentDeleteModal(false)
    }
  };

  const handleCancel = () => {
    setDeleteModal(false);
    props?.setShowCommentDeleteModal(false);
  };

  if (!deleteModal) return null;

  return (
    <ConfirmDialog
      id="confirmDeleteComment"
      icon={Trash2}
      message="Clicking confirm will delete this comment!"
      confirmLabel="Delete comment"
      loadingLabel="Deleting…"
      loading={loading}
      footerVerb="delete"
      onConfirm={() => void confirmFollow()}
      onCancel={handleCancel}
    />
  );
};

export default DeleteCommentById;
