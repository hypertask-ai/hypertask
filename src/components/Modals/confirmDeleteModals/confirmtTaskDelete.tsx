import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { Trash2 } from "lucide-react";

type IProps = {
    confirmDelete: (arg:boolean) =>  Promise<void>,
    content:string;
    loading?:boolean;

}
const ConfirmTaskDelete = ({content, confirmDelete, loading}:IProps) => {
  return (
    <ConfirmDialog
      id="confirmTaskDelete"
      icon={Trash2}
      message={content}
      confirmLabel="Delete task"
      loading={loading}
      footerVerb="delete"
      onConfirm={() => confirmDelete(true)}
      onCancel={() => confirmDelete(false)}
    />
  )
}

export default ConfirmTaskDelete
