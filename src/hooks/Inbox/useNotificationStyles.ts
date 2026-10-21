import { useNotificationContext } from "@/lib/contexts/NotificationContext";

const useNotificationStyles = () => {
  const { isIbxSlctd } = useNotificationContext();
  
  const getTextColor = () => isIbxSlctd ? "white" : "#8E9093";
  const getTextClass = () => isIbxSlctd ? "text-white" : "text-[#8E9093]";
  const getBackGroundColor = () => isIbxSlctd ? "bg-[#1A1B1F]" : "bg-white";

  return {
    textColor: getTextColor(),
    textClass: getTextClass(),
    isSelected: isIbxSlctd,
  }
}


export default useNotificationStyles